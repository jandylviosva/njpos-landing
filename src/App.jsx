import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import bcrypt from "bcryptjs";
import { useRegisterSW } from "virtual:pwa-register/react";
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat, NotFoundException } from "@zxing/library";
import { SUPA_URL, SUPA_ANON, supa } from "./lib/supabase.js";
import { uid, fmt } from "./lib/format.js";
import { toLocalDateKey, todayKey, dateInDays, weekStart, monthStart, nowStr } from "./lib/dateUtils.js";
import { crc16, tlv, genQRPh } from "./lib/receipt.js";
import { SyncDot, Alert, QRCode, ProductImg } from "./components/Shared.jsx";
import { DEVICE_ID, initDeviceId, registerDevice, checkDeviceActive } from "./lib/device.js";
import { createLog, addLog } from "./lib/logs.js";
import { isDevSupportSession, LICENSE_KEY, getLicense, saveLicense, STORE_DATA_KEYS, clearStoreData, DB, saveRegisteredStore, getRegisteredStores } from "./lib/storage.js";
import { DEFAULT_THEME, DEV_PASSWORD_HASH, DEVADMIN_PASSWORD_HASH, PROGRAMMER, ALL_PERMISSIONS } from "./lib/constants.js";
import { checkEmail, validateCode, activateStore, upgradeTrialStore, isTrialExpired, getTrialDaysLeft, addDeviceToStore, verifyDevToken } from "./lib/auth.js";
import { sendReportEmail, portalOtpUrl, sendOTP, verifyOTP } from "./lib/email.js";
import { pushToCloud, pullFromCloud } from "./lib/sync.js";
import { ActivationScreen } from "./components/ActivationScreen.jsx";
import { receiptBodyWidthPx, buildReceiptHtml } from "./lib/receiptHtml.js";
import { LBL, INP, Overlay, ModalBox, FRow, Toggle, StockUnitPicker, ProductSearchSelect, RecipeVariantSelect, VariantEditor } from "./components/FormUI.jsx";
import { directPrinter, isIOSDevice, isInstalledPWA, isSafariBrowser, supportsDirectPrint, connectPrinterUSB, connectPrinterBluetooth, tryReconnectPrinter, disconnectPrinter, sendRawToPrinter, buildReceiptEscPos, printReceipt, printReceiptViaDialog, openPrintWindow } from "./lib/printer.js";
import { qtyLabel, receiptQtyLabel, findVariant, variantLabel, computeStock, genOrderId, computeVoucherDiscount, computeBirthdayDiscount, isBirthdayToday, stockUnitLabel, variantPriceRange, applyStockDelta, getShiftPaymentSummary } from "./lib/posHelpers.js";
import { POSView, CameraBarcodeScannerModal } from "./views/POSView.jsx";
import { InventoryView } from "./views/InventoryView.jsx";
import { SettingsView } from "./views/SettingsView.jsx";
import { useBreakpoint } from "./lib/hooks.js";
import { OrdersView } from "./views/OrdersView.jsx";
import { ReportsView, ShiftReportModal } from "./views/ReportsView.jsx";
import { UsersView } from "./views/UsersView.jsx";
import { DevToolsView } from "./views/DevToolsView.jsx";
import { BookingsView, BookingPageSettings } from "./views/BookingsView.jsx";
import { PurchaseOrderView } from "./views/PurchaseOrderView.jsx";
import { InvoiceView } from "./views/InvoiceView.jsx";
import { DashboardView, ScreensaverOverlay } from "./views/DashboardView.jsx";
import { InstallPrompt, UpdateNotifier } from "./components/UpdateInstall.jsx";
import { appIsUpdating, setAppIsUpdating, activeCartCount } from "./lib/appState.js";
import { compressImage, compressDataUrl } from "./lib/images.js";
import { variantCostInfo, computeRecipeCost, genSKU } from "./lib/inventoryHelpers.js";

// appIsUpdating, activeCartCount — moved to src/lib/appState.js

// ════════════════════════════════════════════════════════
// SUPABASE CONFIG
// Keys are loaded from .env (VITE_SUPA_URL / VITE_SUPA_ANON).
// Never hardcode credentials here — add them to your .env file.
// ════════════════════════════════════════════════════════
// SUPABASE CONFIG, supa REST wrapper — moved to src/lib/supabase.js
const SYNC_INTERVAL = 30000;
// Developer access — password is stored as bcrypt hash only, never plain text
// To change the password, generate a new hash with bcrypt.hashSync(newPassword, 10)
// DEV_PASSWORD_HASH, DEVADMIN_PASSWORD_HASH — moved to src/lib/constants.js

// ════════════════════════════════════════════════════════
// DEVICE ID — persistent UUID stored in localStorage + IndexedDB
// ════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════
// Device identity, registerDevice, checkDeviceActive — moved to src/lib/device.js

// createLog, addLog — moved to src/lib/logs.js

// ════════════════════════════════════════════════════════
// LICENSE / ACTIVATION HELPERS
// ════════════════════════════════════════════════════════

// isDevSupportSession, license get/save, STORE_DATA_KEYS, clearStoreData — moved to src/lib/storage.js

// Check email against Supabase — is it registered?
// checkEmail, validateCode, activateStore, upgradeTrialStore, isTrialExpired,
// getTrialDaysLeft, addDeviceToStore, verifyDevToken — moved to src/lib/auth.js
// RESEND_KEY_STORAGE, sendReportEmail, sendOTP, verifyOTP — moved to src/lib/email.js
// pushToCloud, pullFromCloud — moved to src/lib/sync.js

// Sync dot indicator
// SyncDot — moved to src/components/Shared.jsx

// ════════════════════════════════════════════════════════
// ACTIVATION SCREEN — Email first → code → setup → done
// ════════════════════════════════════════════════════════
// ActivationScreen — moved to src/components/ActivationScreen.jsx

// Alert, QRCode — moved to src/components/Shared.jsx


// ── IMAGE COMPRESSION ──
// Resizes and compresses image to max 300x300px, JPEG quality 0.7
// Reduces a 3MB phone photo to ~30-50KB — safe for Supabase storage
// compressImage — moved to src/lib/images.js

// Same resize/compress pass as compressImage, but for a data URL we
// already have in hand (e.g. a camera snapshot) instead of a File —
// skips the FileReader step since there's no File to read.
// compressDataUrl — moved to src/lib/images.js

// ── ONE-TIME IMAGE MIGRATION ──
// Compresses any existing large base64 images already in localStorage
// Runs once in background after app load — doesn't block anything
const migrateProductImages = async () => {
  try {
    const products = DB.get("products", []);
    let changed = false;
    const migrated = await Promise.all(products.map(async (p) => {
      if(!p.image || p.image.startsWith("data:image/jpeg")) return p; // already JPEG or no image
      if(p.image.length < 10000) return p; // already small enough — skip
      // Compress the existing large image
      const blob = await fetch(p.image).then(r => r.blob());
      const file = new File([blob], "img.png", {type: blob.type});
      const compressed = await compressImage(file, 300, 0.7);
      changed = true;
      return {...p, image: compressed};
    }));
    if(changed) {
      DB.set("products", migrated);
      console.log("[Migration] Compressed existing product images");
    }
  } catch(e) {
    console.log("[Migration] Image compression skipped:", e);
  }
};

// DB (local-store cache) — moved to src/lib/storage.js

// PROGRAMMER — moved to src/lib/constants.js

// DEFAULT_ACCOUNTS no longer ships with demo users.
// The owner account is created fresh on activation using real credentials.
const DEFAULT_ACCOUNTS = [];

// ALL_PERMISSIONS — moved to src/lib/constants.js
const PROGRAMMER_PERMS = ALL_PERMISSIONS.map(p=>p.id);
const OWNER_PERMS      = ["pos","sales_today","sales_weekly","sales_monthly","sales_all","reports_shifts","reports_bir","reports_expenses_view","reports_expenses_manage","orders_view","orders_void","orders_add_manual","inventory_view","inventory_edit","inventory_add","purchase_orders","po_approve","po_receive","po_pay","po_view_all","po_suppliers","po_payments","po_reports","invoices","loyalty","bookings","manage_users","manage_categories","settings","shift_exempt"];
const MANAGER_PERMS    = ["pos","sales_today","sales_weekly","sales_monthly","orders_view","orders_void","inventory_view","inventory_edit","reports_shifts","reports_expenses_view","loyalty","bookings","purchase_orders","po_approve","po_receive","po_pay","po_view_all","po_suppliers","po_payments","po_reports"];
const STAFF_PERMS      = ["pos","sales_today","orders_view","settings_scanner_printer","loyalty","bookings"];

const DEFAULT_ROLES = [
  { id:"role_programmer", name:"Programmer", locked:true,  permissions:PROGRAMMER_PERMS },
  { id:"role_owner",      name:"Owner",      locked:true,  permissions:OWNER_PERMS },
  { id:"role_manager",    name:"Manager",    locked:false, permissions:MANAGER_PERMS },
  { id:"role_staff",      name:"Staff",      locked:true,  permissions:STAFF_PERMS },
];
// Demo accounts removed — owner account is created on activation with real credentials.
// See handleActivated() where the owner account is built from activation form data.
const DEFAULT_CATEGORIES = ["General","Others"];
const DEFAULT_PRODUCTS = [
  { id:"p1",  name:"Chicken Adobo",   price:120, category:"Food",     image:"", stock:50,  sku:"SW00001", active:true },
  { id:"p2",  name:"Pork Sinigang",   price:150, category:"Food",     image:"", stock:30,  sku:"SW00002", active:true },
  { id:"p3",  name:"Pancit Canton",   price:100, category:"Food",     image:"", stock:40,  sku:"SW00003", active:true },
  { id:"p4",  name:"Fried Rice",      price:60,  category:"Food",     image:"", stock:60,  sku:"SW00004", active:true },
  { id:"p5",  name:"Beef Caldereta",  price:180, category:"Food",     image:"", stock:25,  sku:"SW00005", active:true },
  { id:"p6",  name:"Halo-Halo",       price:85,  category:"Desserts", image:"", stock:20,  sku:"SW00006", active:true },
  { id:"p7",  name:"Leche Flan",      price:75,  category:"Desserts", image:"", stock:25,  sku:"SW00007", active:true },
  { id:"p8",  name:"Buko Pandan",     price:60,  category:"Desserts", image:"", stock:30,  sku:"SW00008", active:true },
  { id:"p9",  name:"Coke 500ml",      price:35,  category:"Drinks",   image:"", stock:100, sku:"SW00009", active:true },
  { id:"p10", name:"Iced Tea",        price:30,  category:"Drinks",   image:"", stock:80,  sku:"SW00010", active:true },
  { id:"p11", name:"Mineral Water",   price:20,  category:"Drinks",   image:"", stock:120, sku:"SW00011", active:true },
  { id:"p12", name:"Lumpia Shanghai", price:80,  category:"Snacks",   image:"", stock:50,  sku:"SW00012", active:true },
  { id:"p13", name:"Kwek Kwek",       price:40,  category:"Snacks",   image:"", stock:60,  sku:"SW00013", active:true },
];
// DEFAULT_THEME — moved to src/lib/constants.js
const DEFAULT_SKU   = { prefix:"SW", suffix:"", counter:0 };
const DEFAULT_ORDER_SETTINGS = {
  vatEnabled:false, vatPercent:12, showVat:true, showDiscount:true, isFoodBusiness:true,
  tableFieldLabel:"Table #", takeoutFieldMode:"customer_number", // customer_number | table_label
  orderTypes:[
    { id:"ot1", label:"Dine-in",  enabled:false, locked:true },
    { id:"ot2", label:"Take-out", enabled:false, locked:true },
  ],
  customerNumMode: "per_shift", // per_shift | per_day | manual
  orderSources:[
    { id:"os1", label:"Walk-in",   enabled:true },
    { id:"os2", label:"GrabFood",  enabled:false },
    { id:"os3", label:"FoodPanda", enabled:false },
  ],
  orderNumPrefix: "ORD",
  orderNumFormat: "prefix-datetime",
  orderNumSeqPadding: 5,
  payMethods: [
    { id:"cash",   label:"Cash",   enabled:true,  removable:false, phone:"", accountName:"" },
    { id:"gcash",  label:"GCash",  enabled:false, removable:true,  phone:"", accountName:"" },
    { id:"maya",   label:"Maya",   enabled:false, removable:true,  phone:"", accountName:"" },
  ],
  // Printer settings
  receiptPaperSize:   "58mm",   // 58mm | 80mm | a4
  receiptPrintMode:   "dialog", // dialog | auto | preview
  receiptAutoPrint:   false,    // auto-print on payment complete (no button click)
  documentPrintMode:  "preview",// preview | dialog
  // Receipt content — what actually shows on the printed slip, separate
  // from the printer/paper mechanics above.
  receiptShowLogo:    false,
  receiptShowAddress: true,
  receiptShowCashier: true,
  receiptFooterMsg:   "Thank you! Please come again.",
  enableOpenBills: false, // allow saving orders as open bills (pay later)
  enableKitchenTicket: false, // print kitchen order ticket below customer receipt
  // Barcode scanner
  barcodeWedgeIdleMs: 120,   // max gap (ms) between keystrokes to still count as one scan, not typing
  barcodeMinLength:   3,     // shortest code length treated as a real scan
  cameraScanEnabled:  false, // show the "Scan with Camera" button in POS
  // Direct printer (WebUSB/Web Bluetooth) — only relevant once a printer
  // is actually connected via Settings → Printer; harmless no-ops otherwise.
  receiptFeedLines:   4,     // blank lines fed after printing, before tear/cut
  receiptAutoCut:     false, // whether to send the auto-cut command at all
};

const DEFAULT_PRINTER_SETTINGS = {
  receiptPaperSize:  "58mm",
  receiptPrintMode:  "dialog",
  receiptAutoPrint:  false,
  documentPrintMode: "preview",
};

// uid, fmt — moved to src/lib/format.js

// ── VARIANT HELPERS ──
// A product with hasVariants:true stores its sellable combinations in
// `variants`: [{id, options:{[typeName]: optionValue}, price, stock, uses, sku}].
// Top-level price/stock are ignored for such products — each variant
// carries its own. The first entry in `variantTypes` is always treated
// as the primary/main axis for display grouping and POS ordering.
//
// `variantStockMode` controls how variant stock is tracked:
//  - "independent" (default): each variant has its own separate `stock`
//    count, e.g. Red/Small and Red/Medium are tracked completely apart.
//  - "shared": all variants draw from ONE pool (`sharedStock`, in some
//    base unit) instead of having their own count. Each variant instead
//    has a `uses` field — how many base units one unit of that variant
//    consumes. This is for things like rice sold as 1kg/2kg/5kg bags,
//    all coming out of the same kg-tracked stockroom: selling a "2kg"
//    bag should take 2 off the shared total, not 1 off some separate
//    "2kg bags" counter that doesn't actually reflect the real stockroom.
// Preset stock units offered in the picker; "Other" reveals a free-text
// input for anything not covered (sacks, trays, whatever a store uses).
// STOCK_UNITS — moved to src/components/FormUI.jsx
// stockUnitLabel — moved to src/lib/posHelpers.js
// For a weight-priced cart/order line, item.qty IS the weight already
// (e.g. 1.05) — this shows "1.05 kg" instead of the usual "×N". Falls
// back to the normal format for everything else, including orders
// saved before this feature existed (soldByWeight was never set, so
// this is always false for them — no migration needed).
// qtyLabel, receiptQtyLabel, findVariant, variantLabel — moved to src/lib/posHelpers.js
// variantPriceRange — moved to src/lib/posHelpers.js
// Cost summary for a variant product's table row. Shared-pool mode has
// one cost covering the whole pool (set on the product itself, since
// every variant draws from the same stock) — independent mode has a
// separate cost per variant, so this returns a min–max range instead,
// same shape as variantPriceRange, plus whether every variant that's
// actually priced also has a cost set.
// variantCostInfo — moved to src/lib/inventoryHelpers.js
// How many base units of shared stock a given quantity of a variant
// consumes. In independent mode, a "unit" of stock IS a unit of the
// variant, so this is just qty; in shared mode, each unit of the
// variant consumes variant.uses base units.
// variantUnitsFor — moved to src/lib/posHelpers.js

// Compute available stock for a product based on its inclusions.
// Manual products: returns p.stock as-is (backwards compatible).
// Auto products: returns Math.floor(min(inclusionStock / qtyNeeded)).
// If `variantId` is given and the product has variants, returns how many
// of that specific variant can currently be sold: its own stock count in
// independent mode, or floor(sharedStock / variant.uses) in shared mode.
// Without a variantId, a variant product returns the total stock on
// hand — summed per-variant stock in independent mode, or the raw
// shared pool number in shared mode (used for the POS grid's aggregate
// "in/out of stock" badge before the picker opens).
// computeStock — moved to src/lib/posHelpers.js

// Cost basis for a recipe/auto-stock product, computed live from each
// ingredient's own Cost Price × how much of it the recipe uses — same
// "derive it, don't store it" approach computeStock uses for stock, so
// it can never drift out of sync when an ingredient's cost changes.
// `complete` is false if any ingredient is missing, deleted, a variant
// product (no per-variant cost support yet), or has no cost price set —
// callers should say so plainly rather than silently treating it as ₱0.
// computeRecipeCost — moved to src/lib/inventoryHelpers.js

// Apply (or reverse, with sign=-1) a stock change for a sold/voided
// cart across `products`. Handles three cases at once:
//  1. Direct deduction from a variant's own stock (it.variantId set) —
//     either its independent count, or its share of a shared pool.
//  2. Direct deduction from a plain (non-variant) product's stock
//  3. Deduction from inclusion/recipe ingredients — including a
//     specific variant of an ingredient, when the recipe row that
//     references it was configured with a variantId.
// `items` is order.items: [{productId, variantId, qty}, ...]. sign=1 deducts, sign=-1 restores.
// applyStockDelta — moved to src/lib/posHelpers.js

// Format a Date as YYYY-MM-DD using LOCAL time components, not UTC.
// CRITICAL: .toISOString() always returns UTC — for PH (UTC+8), any
// order placed between 12:00am-8:00am local time would get stamped
// with the PREVIOUS day's date, silently excluding it from "Today"
// reports even though it shows the correct local timestamp elsewhere
// in the UI. This was the root cause of "Today" showing ₱0.00 despite
// visible paid orders from earlier that morning.
// NOTE FOR THE FUTURE — read this before adding stores outside the
// Philippines. This function (and todayKey/weekStart/monthStart below
// it) use the BROWSER'S device clock and local timezone. That's
// correct today because every device running this app physically sits
// in the Philippines. If you ever onboard a store in a different
// timezone, "Today" on that device would be computed using whatever
// timezone the device itself is set to — usually fine if the device
// is genuinely local to the store, but it means dateKey values are NOT
// centrally consistent across stores in different timezones (unlike a
// single global "PH time" assumption, which at least guarantees every
// PH store agrees on what day it is). If that ever matters, the real
// fix is a per-store timezone setting (e.g. stores.timezone) that
// flows into store_data and gets used here instead of the device's
// own clock — see the conversation that added this comment for the
// full design discussion of why that's a bigger change than it looks
// (needs to touch PWA, Portal, and Dev Console consistently, since all
// three independently compute dateKey-based date filters today).
// toLocalDateKey, todayKey, dateInDays, weekStart, monthStart, nowStr — moved to src/lib/dateUtils.js
// genSKU — moved to src/lib/inventoryHelpers.js

// Generate order ID based on settings
// genOrderId — moved to src/lib/posHelpers.js

// ── PRINTER SETTINGS (read from localStorage) ──
const getPrinterSettings = () => {
  try {
    const os = JSON.parse(localStorage.getItem("pospro_orderSettings")||"{}");
    return {
      // Falls back to 80mm (the old default), not the new 58mm default —
      // this specific fallback only matters for an EXISTING customer
      // whose stored settings object is missing this one field (e.g.
      // saved before paper size was configurable). A genuinely new
      // customer never hits this fallback at all, since their whole
      // orderSettings object already resolves to DEFAULT_ORDER_SETTINGS
      // (58mm) the moment it's created — so this line only exists to
      // keep an existing customer's silent, unnoticed default exactly
      // as it was, not to reintroduce 80mm as anyone's actual default.
      receiptPaperSize:  os.receiptPaperSize  || "80mm",
      receiptPrintMode:  os.receiptPrintMode  || "dialog",
      receiptAutoPrint:  os.receiptAutoPrint  || false,
      documentPrintMode: os.documentPrintMode || "preview",
    };
  } catch { return DEFAULT_PRINTER_SETTINGS; }
};

// Print helper — opens a popup window and triggers print
// openPrintWindow — moved to src/lib/printer.js

const PRINT_STYLES = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:12px;padding:20px;color:#111}
  h1{font-size:18px;font-weight:800;margin-bottom:4px}
  h2{font-size:13px;font-weight:700;margin:16px 0 8px;color:#2563EB;border-bottom:2px solid #2563EB;padding-bottom:4px}
  .meta{font-size:11px;color:#6b7280;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px}
  th{background:#f3f4f6;padding:6px 8px;text-align:left;font-weight:700;font-size:11px;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb}
  td{padding:6px 8px;border-bottom:1px solid #f3f4f6}
  tr:last-child td{border-bottom:none}
  .right{text-align:right} .bold{font-weight:800}
  .summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:16px}
  .card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px}
  .card-label{font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px}
  .card-val{font-size:20px;font-weight:800;color:#2563EB;margin-top:4px}
  .green{color:#166534} .red{color:#991b1b}
  .no-print{margin-top:24px;text-align:right}
  @media print{.no-print{display:none!important}body{padding:10px}}
`;

const PRINT_BUTTONS = `
  <div class="no-print">
    <button onclick="window.print()" style="padding:10px 22px;background:#2563EB;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:800">🖨️ Print</button>
    <button onclick="window.close()" style="padding:10px 22px;background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;font-size:14px;font-weight:700;margin-left:8px">✕ Close</button>
  </div>
`;

const printReport = (html, title) => {
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title||"Report"}</title><style>${PRINT_STYLES}</style></head><body>${html}${PRINT_BUTTONS}</body></html>`;
  openPrintWindow(fullHtml);
};

// useBreakpoint — moved to src/lib/hooks.js

// ProductImg — moved to src/components/Shared.jsx

// Shared by buildReceiptHtml and the Settings preview, so the preview
// container is always sized to match whatever the selected paper size
// will actually render at — no separate hardcoded width to fall out of
// sync with this one.
// receiptBodyWidthPx, buildReceiptHtml — moved to src/lib/receiptHtml.js

// Sample order used to render the live preview in Settings → Receipt —
// never actually sent anywhere, purely illustrative.
// SAMPLE_RECEIPT_ORDER — moved to src/views/SettingsView.jsx (local)

// Direct ESC/POS printer support (WebUSB/Bluetooth) — moved to src/lib/printer.js
// LBL, INP, Overlay, ModalBox, FRow, Toggle, StockUnitPicker, ProductSearchSelect, RecipeVariantSelect, VariantEditor — moved to src/components/FormUI.jsx

// ════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════
// ── PWA INSTALL PROMPT ──
// InstallPrompt — moved to src/components/UpdateInstall.jsx

// UpdateNotifier — moved to src/components/UpdateInstall.jsx

export default function App(){
  return (
    <>
      <UpdateNotifier/>
      <AppInner/>
      <InstallPrompt/>
    </>
  );
}

function AppInner(){
  // Tracks actual browser fullscreen state (not just "did we ask for it") —
  // covers the fullscreenchange event firing from ANY source: the sidebar
  // toggle below, the auto-request on login, the browser's own Esc/back
  // exit, or a device rotating out of it. Keeping this in sync with the
  // real DOM state (rather than a simple boolean the button just flips)
  // means the icon never lies about what's actually on screen.
  const [isFullscreen,setIsFullscreen] = useState(()=>!!document.fullscreenElement);
  useEffect(()=>{
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  },[]);
  const toggleFullscreen = () => {
    if(document.fullscreenElement){
      document.exitFullscreen?.().catch(()=>{});
    } else {
      document.documentElement.requestFullscreen?.().catch(()=>{});
    }
  };
  const [products,setProducts]         = useState(()=>DB.get("products",[]));
  const [orders,setOrders]             = useState(()=>DB.get("orders",[]));
  const [shifts,setShifts]             = useState(()=>DB.get("shifts",[]));
  const [accounts,setAccounts]         = useState(()=>DB.get("accounts",[]));
  const [roles,setRoles]               = useState(()=>DB.get("roles",DEFAULT_ROLES));
  const [categories,setCategories]     = useState(()=>DB.get("categories",DEFAULT_CATEGORIES));
  const [theme,setTheme]               = useState(()=>DB.get("theme",DEFAULT_THEME));
  const [skuSettings,setSku]           = useState(()=>DB.get("skuSettings",DEFAULT_SKU));
  const [uiSettings,setUiSettings]=useState(()=>DB.get("uiSettings",{textSize:"normal"}));
  useEffect(()=>{DB.set("uiSettings",uiSettings);},[uiSettings]);
  // Purely per-device — deliberately NEVER read from or written to cloud
  // sync (no push, no pull, not part of the store_data row at all).
  // cardSize/cartWidth are about fitting THIS device's own screen, not a
  // store-wide preference — putting them in the synced uiSettings blob
  // meant any device's change could get silently reverted by the next
  // periodic pull picking up whatever a DIFFERENT device (or the cloud)
  // last had, which is exactly the bug this was built to fix.
  const [deviceSettings,setDeviceSettings]=useState(()=>DB.get("deviceSettings",{cardSize:"normal",cartWidth:"normal"}));
  useEffect(()=>{DB.set("deviceSettings",deviceSettings);},[deviceSettings]);
  const [orderSettings,setOrderSettings]=useState(()=>{
    const saved = DB.get("orderSettings", DEFAULT_ORDER_SETTINGS);
    const BUILT_INS = [
      { id:"ot1", label:"Dine-in",  enabled:false, locked:true },
      { id:"ot2", label:"Take-out", enabled:false, locked:true },
    ];
    const types = saved.orderTypes || [];
    // Ensure built-in Dine-in / Take-out are always present and locked
    const hasOt1 = types.some(t=>t.id==="ot1");
    const hasOt2 = types.some(t=>t.id==="ot2");
    const needsPatch = !hasOt1 || !hasOt2 || types.some(t=>(t.id==="ot1"||t.id==="ot2")&&!t.locked);
    if(needsPatch){
      const withBuiltIns = [
        ...BUILT_INS.filter(bi=>!types.some(t=>t.id===bi.id)),
        ...types.map(t=>(t.id==="ot1"||t.id==="ot2")?{...t,locked:true}:t),
      ];
      const patched = {
        ...saved,
        orderTypes: withBuiltIns,
        customerNumMode: saved.customerNumMode||"per_shift",
      };
      DB.set("orderSettings", patched);
      return patched;
    }
    return saved;
  });
  const [businessDetails,setBusinessDetails]=useState(()=>DB.get("businessDetails",null));
  // Purchase Orders & Invoices (dev-enabled modules)
  const [suppliers,setSuppliers]     = useState(()=>DB.get("suppliers",[]));
  const [purchaseOrders,setPOs]      = useState(()=>DB.get("purchaseOrders",[]));
  const [customers,setCustomers]     = useState(()=>DB.get("customers",[]));
  const [invoices,setInvoices]       = useState(()=>DB.get("invoices",[]));
  const [storeExpenses,setStoreExpenses] = useState(()=>DB.get("storeExpenses",[]));
  const [countSessions,setCountSessions] = useState(()=>DB.get("countSessions",[]));
  const [loyaltyRewards,setLoyaltyRewards] = useState(()=>DB.get("loyaltyRewards",[]));
  const [bookingResources,setBookingResources] = useState(()=>DB.get("bookingResources",[]));
  const [bookingPageContent,setBookingPageContent] = useState(()=>DB.get("bookingPageContent",[]));
  const [bookingPageSettings,setBookingPageSettings] = useState(()=>DB.get("bookingPageSettings",{}));
  const [bookingServices,setBookingServices]   = useState(()=>DB.get("bookingServices",[]));
  const [bookings,setBookings]                 = useState(()=>DB.get("bookings",[]));
  const [enablePO,setEnablePO]       = useState(()=>DB.get("enablePO",false));
  const [enableInvoice,setEnableInvoice] = useState(()=>DB.get("enableInvoice",false));
  const [enableLoyalty,setEnableLoyalty] = useState(()=>DB.get("enableLoyalty",false));
  const [enableBookings,setEnableBookings] = useState(()=>DB.get("enableBookings",false));
  // Kitchen Order Ticket used to be a single shared boolean
  // (orderSettings.enableKitchenTicket) that BOTH the developer's module
  // toggle and the store's own "do I want this on" preference wrote to —
  // meaning there was no way to tell "dev never enabled it" apart from
  // "store chose not to use it," and a store could flip it on even if
  // the developer never granted the feature at all. Splitting into two:
  // this flag is the dev-only gate (mirrors enablePO/enableInvoice),
  // while orderSettings.enableKitchenTicket remains the store's own
  // preference, only meaningful when this is true. Falls back to
  // whatever the old shared flag already was, so stores that had it
  // working before this split don't suddenly lose it.
  const [kitchenModuleEnabled,setKitchenModuleEnabled] = useState(()=>DB.get("kitchenModuleEnabled", DB.get("orderSettings",{}).enableKitchenTicket||false));
  // Same two-tier split as Kitchen Ticket — Dev Tools controls whether
  // Open Bills is AVAILABLE at all; orderSettings.enableOpenBills is the
  // store's own preference for whether they actually want to use it,
  // only meaningful once this is true. Previously these were the exact
  // same field, meaning Dev Tools turning it on FORCED it on for the
  // store too, with no way for the owner to opt out while still having
  // it available. Falls back to whatever the old shared flag already
  // was, so stores that had it working before this split don't suddenly
  // lose it.
  const [openBillsModuleEnabled,setOpenBillsModuleEnabled] = useState(()=>DB.get("openBillsModuleEnabled", DB.get("orderSettings",{}).enableOpenBills||false));
  const [logs,setLogs]                 = useState(()=>DB.get("logs",[]));
  // Use sessionStorage for session — clears automatically when app is closed
  // localStorage would persist session forever which is a security risk on shared devices
  const [session,setSession] = useState(()=>{
    try { const s = sessionStorage.getItem("pospro_session"); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [activeShifts,setActiveShifts] = useState(()=>DB.get("activeShifts",null) ?? (DB.get("activeShift",null) ? [DB.get("activeShift",null)] : []));
  const [shiftStartBusy,setShiftStartBusy] = useState(false); // the pre-login "Start Your Shift" gate's own start action, separate from POSView's
  // The shift open ON THIS DEVICE specifically — at most one device can
  // have a given deviceId, so this is unambiguous. A store with several
  // devices/registers can have several of these active at once across
  // the store; this device only ever cares about its own. Whether that
  // shift belongs to the current session or someone else (requiring a
  // handoff) is resolved by requiresShift()/needsHandoff below, exactly
  // as it always was — the only thing that changed is that this used to
  // be a single value for the whole store, now it's scoped per device.
  const activeShift = activeShifts.find(s=>s.deviceId===DEVICE_ID) || null;
  const [view,setView]                 = useState(()=>DB.get("view","pos"));
  // Lets other views (like the printer-reconnect banner) send the user
  // straight to a specific Settings tab instead of just the default —
  // e.g. "go reconnect your printer" should land on Settings → Printer,
  // not the generic Appearance tab someone would then have to navigate
  // away from themselves.
  const [pendingSettingsTab,setPendingSettingsTab] = useState(null);
  const goToSettingsTab = useCallback((tab)=>{ setPendingSettingsTab(tab); setView("settings"); },[]);
  const [toast,setToast]               = useState(null);
  // ── SHIFT SCREENSAVER ──
  // Idle-time overlay shown only while a non-exempt (staff/manager) user
  // is on shift — the owner (or anyone with shift_exempt) never sees
  // this, even if they happen to have voluntarily started a shift.
  // Resets on any interaction anywhere in the app, not just completed
  // sales, so it never interrupts an order that's still being built.
  const [screensaverActive,setScreensaverActive] = useState(false);
  const lastActivityRef = useRef(Date.now());
  // Backstop for the screensaver dismiss click landing on whatever's
  // underneath it (e.g. a product button in POS, adding it to the
  // cart) — the overlay's own onPointerDown already tries to prevent
  // this, but touch devices can still generate a trailing click as
  // part of the same gesture after the overlay unmounts. This swallows
  // any click anywhere in the app for a brief window right after
  // dismissal, in the capture phase so it runs before any button's own
  // handler ever sees it.
  const justDismissedScreensaverRef = useRef(false);
  useEffect(()=>{
    const suppressGhostClick = (e) => {
      if(justDismissedScreensaverRef.current){
        e.stopPropagation();
        e.preventDefault();
      }
    };
    document.addEventListener("click", suppressGhostClick, true);
    return () => document.removeEventListener("click", suppressGhostClick, true);
  },[]);
  const [syncStatus,setSyncStatus]     = useState("offline");
  const [license,setLicenseState]      = useState(()=>getLicense());
  const [prevLicense,setPrevLicense]    = useState(null); // saved license for "back to login" when switching stores
  // Login settings — stored per store+device in localStorage, not synced to cloud
  const getLoginSettingsKey = () => { const lic=getLicense(); return lic?.storeId ? `loginSettings_${lic.storeId}_${DEVICE_ID}` : null; };
  const [loginSettings,setLoginSettingsState] = useState(()=>{ const k=(`loginSettings_${getLicense()?.storeId||"_"}_${DEVICE_ID}`); try{ return JSON.parse(localStorage.getItem(k)||"{}"); }catch{ return {}; } });
  const saveLoginSettings = (val) => { const k=getLoginSettingsKey(); if(k){ try{ localStorage.setItem(k,JSON.stringify(val)); }catch{} } setLoginSettingsState(val); };
  const [switchToEmail,setSwitchToEmail] = useState(null);
  const [isSwitchingStore,setIsSwitchingStore] = useState(false);
  const [activated,setActivated]       = useState(()=>{
    const lic = getLicense();
    if(!lic){
      // Diagnostic for the "logged out after update, back to entering
      // email" issue — a genuinely fresh device would have NONE of its
      // pospro_* keys at all. If other store data clearly survived but
      // the license specifically didn't, that's a very different (and
      // much more useful) signal than "nothing was ever saved here."
      const hasOtherData = !!(localStorage.getItem("pospro_theme") || localStorage.getItem("pospro_accounts"));
      if(hasOtherData){
        console.error("[Boot] No license found, but other store data exists locally — the license specifically appears to have been lost, this isn't a fresh device.", {
          rawLicenseValue: localStorage.getItem("pospro_license"),
          hasTheme: !!localStorage.getItem("pospro_theme"),
          hasAccounts: !!localStorage.getItem("pospro_accounts"),
        });
      }
    }
    return !!lic;
  });
  const [trialUnlocking,setTrialUnlocking] = useState(false); // true = show code entry from trial-expired screen
  // Set from the live license check on every pull (see below) — true when
  // the developer has suspended this store's license (e.g. non-payment).
  // Previously "Suspend" in the dev console only flipped a database field
  // with nothing in the app ever checking it, so suspending a store did
  // nothing at all to the actual client experience.
  const [suspended,setSuspended] = useState(false);
  // ── DEV CONSOLE IMPERSONATION ──
  // Set true only when this session was opened via a ?devtoken= link from
  // the Dev Console. Lives in sessionStorage only — never persisted to
  // localStorage, so closing the tab fully ends the dev-support session
  // (the next normal load of this URL behaves like any other browser).
  const [devSupportMode,setDevSupportMode] = useState(()=>sessionStorage.getItem("pospro_dev_support")==="1");
  const [endingSession,setEndingSession] = useState(false);
  const [devTokenChecking,setDevTokenChecking] = useState(()=>{
    const params = new URLSearchParams(window.location.search);
    return !!params.get("devtoken");
  });
  const [crashRecovery,setCrashRecovery]=useState(null); // detected unfinished shift
  const [logoutWarning,setLogoutWarning]=useState(false); // trying to logout with active shift
  const [postShiftReport,setPostShiftReport] = useState(null); // {shift, needsLogout}
  const toastRef=useRef(null); const syncRef=useRef(null); const bp=useBreakpoint();

  // Silently re-acquire printer connection on every boot/reload
  useEffect(()=>{ tryReconnectPrinter(); },[]);

  useEffect(()=>{DB.set("products",products);},[products]);
  useEffect(()=>{DB.set("orders",orders);},[orders]);
  useEffect(()=>{DB.set("shifts",shifts);},[shifts]);
  useEffect(()=>{DB.set("accounts",accounts);},[accounts]);
  useEffect(()=>{DB.set("roles",roles);},[roles]);

  useEffect(()=>{DB.set("categories",categories);},[categories]);
  useEffect(()=>{DB.set("theme",theme);},[theme]);
  useEffect(()=>{DB.set("skuSettings",skuSettings);},[skuSettings]);
  useEffect(()=>{DB.set("orderSettings",orderSettings);},[orderSettings]);
  useEffect(()=>{if(businessDetails)DB.set("businessDetails",businessDetails);},[businessDetails]);
  useEffect(()=>{DB.set("suppliers",suppliers);},[suppliers]);
  useEffect(()=>{DB.set("purchaseOrders",purchaseOrders);},[purchaseOrders]);
  useEffect(()=>{DB.set("customers",customers);},[customers]);
  useEffect(()=>{DB.set("invoices",invoices);},[invoices]);
  useEffect(()=>{DB.set("storeExpenses",storeExpenses);},[storeExpenses]);
  useEffect(()=>{DB.set("countSessions",countSessions);},[countSessions]);
  useEffect(()=>{DB.set("loyaltyRewards",loyaltyRewards);},[loyaltyRewards]);
  useEffect(()=>{DB.set("bookingResources",bookingResources);},[bookingResources]);
  useEffect(()=>{DB.set("bookingPageContent",bookingPageContent);},[bookingPageContent]);
  useEffect(()=>{DB.set("bookingPageSettings",bookingPageSettings);},[bookingPageSettings]);
  useEffect(()=>{DB.set("bookingServices",bookingServices);},[bookingServices]);
  useEffect(()=>{DB.set("bookings",bookings);},[bookings]);
  useEffect(()=>{DB.set("enablePO",enablePO);},[enablePO]);
  useEffect(()=>{DB.set("enableInvoice",enableInvoice);},[enableInvoice]);
  useEffect(()=>{DB.set("enableLoyalty",enableLoyalty);},[enableLoyalty]);
  useEffect(()=>{DB.set("enableBookings",enableBookings);},[enableBookings]);
  useEffect(()=>{DB.set("kitchenModuleEnabled",kitchenModuleEnabled);},[kitchenModuleEnabled]);
  useEffect(()=>{DB.set("openBillsModuleEnabled",openBillsModuleEnabled);},[openBillsModuleEnabled]);
  useEffect(()=>{DB.set("logs",logs);},[logs]);
  useEffect(()=>{
    try {
      if(session) sessionStorage.setItem("pospro_session", JSON.stringify(session));
      else sessionStorage.removeItem("pospro_session");
    } catch {}
  },[session]);
  // PWA / Android — block the browser back button and tab close
  // when a user is logged in, so staff can't accidentally exit the POS
  useEffect(()=>{
    const handleBeforeUnload = (e) => {
      if(session && !appIsUpdating){
        e.preventDefault();
        e.returnValue = "Please log out before closing the POS.";
        return e.returnValue;
      }
    };
    // Block Android back-button navigation when logged in
    const handlePopState = (e) => {
      if(session){
        // Push a dummy state back so the back button doesn't exit the PWA
        window.history.pushState(null, "", window.location.href);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);
    // Push an initial history entry so popstate fires on back press
    if(session) window.history.pushState(null, "", window.location.href);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  },[session]);

  // ── LOGGING HELPER ──
  const log = useCallback((type, action, detail) => {
    const actor = session?.name || "System";
    const actorRole = session?.roleId || "system";
    setLogs(prev => addLog(prev, type, action, detail, actor, actorRole));
  }, [session]);


  // ── CRASH/BLACKOUT RECOVERY ──
  // A page refresh or browser close clears sessionStorage (session) but leaves
  // localStorage (activeShift, orders, products) completely intact.
  // There is no reliable way to distinguish a refresh from a real crash —
  // both result in session=null with activeShift still in localStorage.
  // The correct behavior is: do nothing. The shift stays exactly as it was.
  // The cashier just logs back in and the shift resumes — same start time,
  // same orders, same running clock. Shifts only close via manual End Shift.
  // (This comment intentionally replaces the old auto-close logic.)

  // ── SHIFT ENFORCEMENT ──
  // Returns true if user can proceed (owner/admin bypass, or active shift)
  const requiresShift = useCallback(() => {
    if(!session) return false;
    // acc_programmer (the hidden Developer account) always bypasses —
    // it's a system account, not a real role a store owner configures.
    if(session.id==="acc_programmer") return false;
    const role = roles.find(r=>r.id===session.roleId);
    const isExempt = role?.permissions?.includes("shift_exempt") ?? false;
    if(isExempt) return false;
    return !activeShift; // everyone without shift_exempt needs a shift
  }, [session, activeShift, roles]);

  const isOwnerOrAdmin = session && (
    session.id==="acc_programmer" ||
    (roles.find(r=>r.id===session.roleId)?.permissions?.includes("shift_exempt") ?? false)
  );

  // Screensaver eligibility: enabled in settings, a non-exempt user is
  // logged in, and they actually have a shift open right now. Any one of
  // these becoming false should also dismiss an already-showing overlay.
  const screensaverEligible = !!(uiSettings.screensaverEnabled && session && !isOwnerOrAdmin && activeShift);
  useEffect(()=>{
    if(!screensaverEligible){ setScreensaverActive(false); return; }
    const idleMs = (uiSettings.screensaverIdleMinutes||5) * 60 * 1000;
    const markActive = () => {
      lastActivityRef.current = Date.now();
      setScreensaverActive(false);
    };
    const events = ["mousedown","keydown","touchstart","wheel"];
    events.forEach(ev=>window.addEventListener(ev, markActive, {passive:true}));
    markActive(); // don't start already-idle just because the eligibility conditions changed
    const checkInterval = setInterval(()=>{
      if(Date.now() - lastActivityRef.current >= idleMs) setScreensaverActive(true);
    }, 5000);
    return ()=>{
      events.forEach(ev=>window.removeEventListener(ev, markActive));
      clearInterval(checkInterval);
    };
  }, [screensaverEligible, uiSettings.screensaverIdleMinutes]);


  // ── SMART SYNC ENGINE ──
  // Strategy:
  //   PUSH — only when something important changed (new order, inventory, login, etc.)
  //           triggered explicitly via triggerSync() after user actions
  //   PULL — every 5 minutes passively, to catch portal/other device changes
  //           also pulls immediately on first load
  // This reduces requests from ~200/day to ~20-50/day per device

  const lastPushTs   = useRef(DB.get("lastPushTs","0"));
  const pendingPush  = useRef(false); // true = local changes waiting to be pushed
  const syncLock     = useRef(false);

  // ── PULL ONLY — check if portal/other device changed something ──
  // Standalone, deliberately cheap — just the one status field, not a full
  // sync payload — so it's safe to poll far more often than the general
  // 5-minute sync cycle without meaningfully increasing load. Suspension
  // needs to actually feel close to immediate, not "eventually, next time
  // something else happens to sync"; the full doPull cadence was fine for
  // trial-expiry checks but way too slow for someone who just got
  // suspended for non-payment.
  const checkSuspension = useCallback(async () => {
    const lic = getLicense();
    if(!lic?.storeId) return;
    try {
      const storeRow = await supa.get("stores",{id:lic.storeId},"id,license_id");
      if(!storeRow?.license_id) return;
      const licRow = await supa.get("licenses",{id:storeRow.license_id},"id,status");
      setSuspended(licRow?.status==="suspended");
    } catch {}
  }, []);

  const doPull = useCallback(async () => {
    const lic = getLicense();
    if(!lic?.storeId) return;
    if(syncLock.current) return;
    syncLock.current = true;
    setSyncStatus("syncing");
    try {
      const cloud = await pullFromCloud(lic.storeId);
      if(cloud) {
        const cloudUpdatedAt = cloud.updated_at || "0";
        const myLastPush     = lastPushTs.current || "0";

        // Also require !pendingPush.current — otherwise a local-only
        // change made between a push and its next tick (e.g. the stock
        // restore when reopening an open bill) can get silently wiped
        // by this same pull, before it's ever had a chance to go out.
        // That's exactly what caused stock to get double-deducted when
        // reopening an open bill and adding more items to it.
        const portalMadeChanges = cloudUpdatedAt > myLastPush && !pendingPush.current;
        if(portalMadeChanges) {
          const applyCloud = (cloudVal, setter, localKey, check) => {
            if(cloudVal && check(cloudVal)) { setter(cloudVal); DB.set(localKey, cloudVal); }
          };
          // Compress any existing oversized PNG images from cloud
        if(Array.isArray(cloud.products)) {
          const needsCompression = cloud.products.filter(p =>
            p.image && p.image.startsWith("data:image/png") && p.image.length > 50000
          );
          if(needsCompression.length > 0) {
            const compressBase64 = (base64) => new Promise(resolve => {
              const img = new Image();
              img.onload = () => {
                const canvas = document.createElement("canvas");
                let w = img.width, h = img.height, maxSize = 300;
                if(w > maxSize || h > maxSize) {
                  if(w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                  else       { w = Math.round(w * maxSize / h); h = maxSize; }
                }
                canvas.width = w; canvas.height = h;
                canvas.getContext("2d").drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL("image/jpeg", 0.7));
              };
              img.src = base64;
            });
            cloud.products = await Promise.all(
              cloud.products.map(async p => {
                if(p.image && p.image.startsWith("data:image/png") && p.image.length > 50000)
                  return {...p, image: await compressBase64(p.image)};
                return p;
              })
            );
            // Mark pending push so compressed images get saved back
            pendingPush.current = true;
          }
        }

        applyCloud(cloud.products,       setProducts,      "products",      v=>Array.isArray(v)&&v.length>0);
          const localAccounts = DB.get("accounts",[]);
          if(Array.isArray(cloud.accounts)&&cloud.accounts.length>0) {
            if(cloud.accounts.length >= localAccounts.length) {
              const merged = cloud.accounts.map(ca => {
                const local = localAccounts.find(la => la.id === ca.id);
                if(local?.password?.startsWith("$2") && !ca.password?.startsWith("$2")) return {...ca, password: local.password};
                return ca;
              });
              setAccounts(merged); DB.set("accounts", merged);
            }
          }
          applyCloud(cloud.categories,     setCategories,    "categories",    v=>Array.isArray(v)&&v.length>0);
          applyCloud(cloud.roles,          setRoles,         "roles",         v=>Array.isArray(v)&&v.length>0);
          applyCloud(cloud.theme,          setTheme,         "theme",         v=>v&&typeof v==="object"&&Object.keys(v).length>0);
          applyCloud(cloud.sku_settings,   setSku,           "skuSettings",   v=>v&&v.prefix);
          // Require payMethods to exist before applying cloud order_settings locally —
          // prevents an empty {} from a bad sync overwriting a device's good local copy.
          applyCloud(cloud.order_settings, setOrderSettings, "orderSettings", v=>v&&typeof v==="object"&&Array.isArray(v.payMethods)&&v.payMethods.length>0);
          // These previously only ever got read during the ONE-TIME initial
          // activation flow (handleActivated) — never during this ongoing
          // periodic sync, which is what actually runs for the entire rest
          // of a device's life. A setting changed from Dev Tools, another
          // device, or the portal would save correctly (confirmed via
          // network payload) but never be picked up here — not on the next
          // sync, not after logout/login, not even after a reinstall if a
          // valid local session let it skip straight past activation.
          applyCloud(cloud.ui_settings,        setUiSettings,     "uiSettings",     v=>v&&typeof v==="object"&&Object.keys(v).length>0);
          applyCloud(cloud.business_details,   setBusinessDetails,"businessDetails",v=>v&&typeof v==="object");
          applyCloud(cloud.suppliers,          setSuppliers,      "suppliers",      v=>Array.isArray(v));
          applyCloud(cloud.purchase_orders,    setPOs,            "purchaseOrders", v=>Array.isArray(v));
          applyCloud(cloud.customers,          setCustomers,      "customers",      v=>Array.isArray(v));
          applyCloud(cloud.invoices,           setInvoices,       "invoices",       v=>Array.isArray(v));
          applyCloud(cloud.loyalty_rewards,     setLoyaltyRewards, "loyaltyRewards", v=>Array.isArray(v));
          applyCloud(cloud.booking_resources,   setBookingResources, "bookingResources", v=>Array.isArray(v));
          applyCloud(cloud.booking_page_content, setBookingPageContent, "bookingPageContent", v=>Array.isArray(v));
          applyCloud(cloud.booking_page_settings, setBookingPageSettings, "bookingPageSettings", v=>v&&typeof v==="object");
          applyCloud(cloud.booking_services,    setBookingServices,  "bookingServices",  v=>Array.isArray(v));
          applyCloud(cloud.bookings,            setBookings,         "bookings",         v=>Array.isArray(v));
          // active_shifts needs its own handling, not applyCloud — an
          // empty list is a legitimate, meaningful cloud value here (no
          // device has a shift open right now), but applyCloud's
          // `cloudVal &&` guard would treat that as "nothing to apply"
          // and skip it. Falls back to migrating the old single-shift
          // field for any store that still has one saved from before
          // this became a per-device list — a live shift shouldn't just
          // vanish the moment this ships.
          const nextShifts = Array.isArray(cloud.active_shifts)
            ? cloud.active_shifts
            : (cloud.active_shift ? [cloud.active_shift] : []);
          setActiveShifts(nextShifts);
          DB.set("activeShifts", nextShifts);
          if(cloud.kitchen_module_enabled!==undefined){ setKitchenModuleEnabled(!!cloud.kitchen_module_enabled); DB.set("kitchenModuleEnabled", !!cloud.kitchen_module_enabled); }
          if(cloud.open_bills_module_enabled!==undefined){ setOpenBillsModuleEnabled(!!cloud.open_bills_module_enabled); DB.set("openBillsModuleEnabled", !!cloud.open_bills_module_enabled); }
          if(cloud.enable_po!==undefined){ setEnablePO(!!cloud.enable_po); DB.set("enablePO", !!cloud.enable_po); }
          if(cloud.enable_invoice!==undefined){ setEnableInvoice(!!cloud.enable_invoice); DB.set("enableInvoice", !!cloud.enable_invoice); }
          if(cloud.enable_loyalty!==undefined){ setEnableLoyalty(!!cloud.enable_loyalty); DB.set("enableLoyalty", !!cloud.enable_loyalty); }
          if(cloud.enable_bookings!==undefined){ setEnableBookings(!!cloud.enable_bookings); DB.set("enableBookings", !!cloud.enable_bookings); }
          if(cloud.allow_screenshots!==undefined){ DB.set("allowScreenshots", !!cloud.allow_screenshots); }
        }
        // Always merge transactional data
        if(Array.isArray(cloud.orders)) {
          const localOrders = DB.get("orders",[]);
          const merged = [...localOrders];
          const newlyDiscovered = [];
          cloud.orders.forEach(co=>{
            const idx = merged.findIndex(lo=>lo.id===co.id);
            if(idx===-1) newlyDiscovered.push(co);
            // A status change on an order this device already has (most
            // commonly open→paid, but this was ONLY special-cased for
            // open→void before) has to win over the stale local copy —
            // otherwise a bill paid on one device never shows as paid on
            // any other device that already had it as "open" locally,
            // no matter how many times that device syncs. Leaving same-
            // status entries alone still protects an order genuinely
            // being edited locally right now from a same-status pull
            // clobbering it mid-edit.
            //
            // The !pendingPush.current check below is just as important
            // as the status check itself: THIS device may have just
            // voided an order / collected a preorder balance / cancelled
            // one, locally, moments ago — if that change hasn't been
            // pushed out yet, the cloud's copy is the STALE one here,
            // not the local one. Without this guard, a pull landing in
            // that window (much more likely now that pulls run every
            // 60s instead of every 5min) silently undoes the fresh
            // local change, which is exactly what caused a just-voided
            // order to revert to "paid" with its stock restore undone
            // right along with it. New orders (the branch above) are
            // still merged in unconditionally either way — a genuinely
            // new order from another device never conflicts with
            // anything pending locally.
            else if(co.status!==merged[idx].status && !pendingPush.current) merged[idx]=co;
          });
          // Prepend every newly-discovered order together, in one shot,
          // sorted newest-first by its own creation time — NOT one at a
          // time inside the loop above. Unshifting one at a time silently
          // REVERSES the relative order of any batch of more than one new
          // order merged in a single pull (e.g. after this device was
          // offline for a while and catches up on several at once), which
          // is exactly why the Orders list could show correctly-ordered
          // chunks that were themselves out of sequence relative to each
          // other — a near-identical bug to the one already fixed for the
          // Logs tab, just one step subtler since unshift is the right
          // idea, only wrong when done per-item instead of per-batch.
          if(newlyDiscovered.length){
            newlyDiscovered.sort((a,b)=>new Date(b.date)-new Date(a.date));
            merged.unshift(...newlyDiscovered);
          }
          setOrders(merged); DB.set("orders",merged);
        }
        if(Array.isArray(cloud.shifts)) {
          const localShifts = DB.get("shifts",[]);
          const merged = [...localShifts];
          // Same bug as orders/logs had — unshifting one at a time inside
          // the loop reverses the relative order of any batch of more
          // than one newly-discovered shift merged in a single pull.
          // Push then sort the whole array by startTime afterward, same
          // fix already proven for logs — shifts arrays are small enough
          // that a full re-sort on every pull is negligible cost.
          cloud.shifts.forEach(cs=>{ if(!merged.find(ls=>ls.id===cs.id)) merged.push(cs); });
          merged.sort((a,b)=>new Date(b.startTime)-new Date(a.startTime));
          setShifts(merged); DB.set("shifts",merged);
        }
        if(Array.isArray(cloud.logs)) {
          const localLogs = DB.get("logs",[]);
          const merged = [...localLogs];
          // Unlike orders/shifts, logs are meant to always stay
          // newest-first (addLog() itself prepends every new entry —
          // see lib/logs.js). A log entry created on another device
          // that this device doesn't have yet was previously just
          // pushed onto the END of the array here, which is why a
          // newly-synced log would show at the bottom of the Logs tab
          // instead of the top. Sorting by timestamp after merging
          // guarantees correct order regardless of which device
          // created which entry or which order they arrive in.
          cloud.logs.forEach(cl=>{ if(!merged.find(ll=>ll.id===cl.id)) merged.push(cl); });
          merged.sort((a,b)=>new Date(b.ts)-new Date(a.ts));
          setLogs(merged); DB.set("logs",merged);
        }
      }
      // Check device registration (every pull)
      const isActive = await checkDeviceActive(lic.storeId);
      if(!isActive){
        // Don't trust a single "not found" enough to wipe local data and
        // force re-activation — that's the most destructive thing this
        // app does to a device, and registerDevice's own read-modify-
        // write race (see its comment) can still cause a false negative
        // here even after its retries. A short pause + a second read
        // gives any in-flight concurrent write elsewhere time to settle,
        // so this only fires for a device that's actually, confirmedly,
        // still missing — not a device that just lost a timing race.
        await new Promise(r=>setTimeout(r, 800));
        const stillInactive = !(await checkDeviceActive(lic.storeId));
        if(stillInactive){
          console.error("[Sync] Device no longer registered — clearing and reloading.", {deviceId: DEVICE_ID, storeId: lic.storeId, isDevSupport: isDevSupportSession()});
          clearStoreData();
          alert("This device has been removed from your store.\n\nThe app will now restart for you to re-activate.");
          window.location.reload();
          return;
        } else {
          await registerDevice(lic.storeId, lic.deviceName||"POS");
        }
      } else {
        await registerDevice(lic.storeId, lic.deviceName||"POS");
      }
      // ── LIVE TRIAL EXPIRY CHECK ──
      // Re-fetch the license from Supabase on every pull so the trial lock screen
      // activates the moment trial_expires_at passes — even while the user is logged in.
      if(lic.storeId) {
        try {
          const storeRow = await supa.get("stores",{id:lic.storeId},"id,license_id");
          if(storeRow?.license_id) {
            const licRow = await supa.get("licenses",{id:storeRow.license_id});
            if(licRow?.trial_expires_at) {
              // Update the local license with the authoritative expiry from server
              const updatedLic = {...lic, trialExpiresAt: licRow.trial_expires_at, plan: licRow.plan||lic.plan};
              saveLicense(updatedLic);
              setLicenseState(updatedLic);
            }
            setSuspended(licRow?.status==="suspended");
          }
        } catch {}
      }
      setSyncStatus(pendingPush.current ? "syncing" : "synced");
    } catch { setSyncStatus("error"); }
    finally { syncLock.current = false; }
  }, []);

  // ── PUSH — send local changes to cloud ──
  const doPush = useCallback(async (markPending = false) => {
    const lic = getLicense();
    if(!lic?.storeId) {
      console.error("[Sync] doPush aborted — no valid license/storeId found.", {lic, isDevSupport: isDevSupportSession(), sessionFlag: sessionStorage.getItem("pospro_dev_support")});
      setSyncStatus("offline");
      return false;
    }
    // markPending: the caller just made a deliberate local change (e.g. a
    // module toggle in Dev Tools) and is pushing it right now. Setting
    // pendingPush BEFORE the staleness pull below makes that pull's
    // portalMadeChanges guard (which requires !pendingPush.current) skip
    // re-applying cloud scalar values — otherwise the pull would overwrite
    // the just-toggled flag with the stale cloud value and the toggle would
    // appear to "snap back". Normal periodic syncs pass nothing here and
    // behave exactly as before.
    if(markPending) pendingPush.current = true;
    // ── STALENESS GUARD ──
    // doPush unconditionally builds its payload from whatever this device
    // currently has in local storage and overwrites the ENTIRE cloud row
    // with it. If this device has been sitting idle (closed, backgrounded,
    // just reopened after a while) its local snapshot can be genuinely
    // behind — another device may have sold stock, started a shift, or
    // changed something since this device last synced. Pushing that stale
    // snapshot blindly doesn't just fail to reflect the other device's
    // changes — it actively erases them, since this is a whole-row
    // overwrite, not a merge. This is a real, observed failure mode: a
    // device's own product stock counts and active shift were reverted to
    // an earlier state after exactly this kind of push. Checking the
    // cloud's timestamp first — the same cheap, single-column check
    // checkPortalChanges already uses — and pulling first if this device
    // is behind means every push is now built from current data, not
    // whatever happened to be sitting in storage.
    if(syncLock.current) return false;
    // ── MERGE-MANAGED FIELDS ──
    // bookings / customers / loyalty_rewards / active_shifts each have their
    // own merge-safe write path (syncBookingEntry etc.), and the public
    // booking API writes bookings from OUTSIDE this app entirely. A whole-
    // row push overwriting these with whatever local happens to hold can
    // erase an online booking (or another device's points credit) that
    // landed after this device's last pull — the staleness-guard pull above
    // doesn't close that, because doPull deliberately skips applying cloud
    // data while pendingPush is set. So the push below (a) reads the
    // cloud's current copy of these four fields in the same request as the
    // staleness check, (b) UNION-merges them with local by id — cloud
    // entries this device doesn't have are kept, local entries the cloud
    // doesn't have are added, and where both have the same id the local
    // copy wins (it can only differ if a merge-safe write failed offline
    // and fell back to this push) — and (c) writes the whole row guarded
    // on updated_at, retrying against fresh data if anything wrote in
    // between. If the read itself fails, these four fields are simply
    // OMITTED from the payload (PostgREST leaves omitted columns
    // untouched) — a failed read must never become a blind overwrite.
    const MM_FIELDS = [
      ["bookings",        "bookings"],
      ["customers",       "customers"],
      ["loyalty_rewards", "loyaltyRewards"],
      ["active_shifts",   "activeShifts"],
    ];
    const unionMergeById = (cloudArr, localArr) => {
      const out = Array.isArray(cloudArr) ? [...cloudArr] : [];
      const idx = new Map();
      out.forEach((x,i)=>{ if(x&&x.id!==undefined) idx.set(x.id,i); });
      (Array.isArray(localArr)?localArr:[]).forEach(item=>{
        if(!item || item.id===undefined){ out.push(item); return; }
        const i = idx.get(item.id);
        if(i===undefined) out.push(item);
        else if(JSON.stringify(out[i])!==JSON.stringify(item)) out[i]=item;
      });
      return out;
    };
    const readGuardRow = async () => {
      try {
        const r = await fetch(
          `${SUPA_URL}/rest/v1/store_data?store_id=eq.${lic.storeId}&select=updated_at,bookings,customers,loyalty_rewards,active_shifts&limit=1`,
          { headers: { "apikey": SUPA_ANON, "Authorization": `Bearer ${SUPA_ANON}` } }
        );
        if(!r.ok) return null;
        const [row] = await r.json();
        return row || null; // null here also covers "row doesn't exist yet" (fresh store) — handled below via unguarded upsert
      } catch { return null; }
    };
    let guardRow = await readGuardRow();
    // Only reconcile-by-pull when this ISN'T a deliberate local change.
    // When pendingPush is set (e.g. the user just toggled a module off),
    // pulling here would re-apply the cloud's stale value — flipping the
    // toggle back on before we even push. In that case we skip the pull and
    // let the union-merge + CAS below carry the local change up safely.
    // (Matches the !pendingPush.current guard used by the other staleness
    // check above; the rewrite had dropped it here, which caused module
    // toggles to snap back.)
    if(!pendingPush.current && guardRow && (guardRow.updated_at||"0") > (lastPushTs.current||"0")){
      await doPull();
      // re-read after the pull so the guard + merge base reflect what we just applied
      guardRow = await readGuardRow() || guardRow;
    }
    if(syncLock.current) return false;
    syncLock.current = true;
    setSyncStatus("syncing");
    try {
      const buildPayload = (mmRow) => {
        const payload = {
          products:       DB.get("products",      []),
          orders:         DB.get("orders",        []),
          shifts:         DB.get("shifts",        []),
          accounts:       DB.get("accounts",      []),
          categories:     DB.get("categories",    []),
          roles:          DB.get("roles",         []),
          theme:          DB.get("theme",         {}),
          sku_settings:   DB.get("skuSettings",   {}),
          // Only push order_settings if local has real data (payMethods or orderTypes).
          // An empty {} from a fresh/cleared device must never overwrite the cloud —
          // that's what caused payment methods to disappear on due-date syncs.
          ...((ls => ls?.payMethods?.length || ls?.orderTypes?.length
            ? { order_settings: ls } : {})(DB.get("orderSettings", {}))),
          ui_settings:    DB.get("uiSettings",    {}),
          logs:           DB.get("logs",          []),
          suppliers:        DB.get("suppliers",       []),
          purchase_orders:  DB.get("purchaseOrders",  []),
          invoices:         DB.get("invoices",        []),
          store_expenses:   DB.get("storeExpenses",   []),
          count_sessions:   DB.get("countSessions",   []),
          booking_resources: DB.get("bookingResources", []),
          booking_page_content: DB.get("bookingPageContent", []),
          booking_page_settings: DB.get("bookingPageSettings", {}),
          booking_services:  DB.get("bookingServices",  []),
          enable_loyalty:   DB.get("enableLoyalty",    false),
          enable_bookings:  DB.get("enableBookings",   false),
          business_details: DB.get("businessDetails", null),
          enable_po:        DB.get("enablePO",         false),
          enable_invoice:   DB.get("enableInvoice",    false),
          kitchen_module_enabled: DB.get("kitchenModuleEnabled", false),
          open_bills_module_enabled: DB.get("openBillsModuleEnabled", false),
          allow_screenshots:DB.get("allowScreenshots", false),
        };
        if(mmRow){
          MM_FIELDS.forEach(([cloudKey, dbKey])=>{
            payload[cloudKey] = unionMergeById(mmRow[cloudKey], DB.get(dbKey, []));
          });
        }
        return payload;
      };
      const applyMergedLocally = (payload) => {
        // The union may contain cloud-only entries this device was missing
        // (e.g. an online booking that arrived while pendingPush was
        // suppressing pulls) — reflect the exact array we just wrote.
        if(payload.bookings)        { setBookings(payload.bookings);             DB.set("bookings", payload.bookings); }
        if(payload.customers)       { setCustomers(payload.customers);           DB.set("customers", payload.customers); }
        if(payload.loyalty_rewards) { setLoyaltyRewards(payload.loyalty_rewards); DB.set("loyaltyRewards", payload.loyalty_rewards); }
        if(payload.active_shifts)   { setActiveShifts(payload.active_shifts);    DB.set("activeShifts", payload.active_shifts); }
      };
      const MAX_PUSH_ATTEMPTS = 3;
      let ok = false;
      for(let attempt=0; attempt<MAX_PUSH_ATTEMPTS; attempt++){
        const payload = buildPayload(guardRow);
        const result = await pushToCloud(lic.storeId, payload, guardRow?.updated_at || null);
        if(result === true){ ok = true; applyMergedLocally(payload); break; }
        if(result !== "conflict") break; // hard failure (offline) — no point retrying in a tight loop
        // Guard missed — someone wrote between our read and our write.
        // Re-read and retry the merge against the fresh cloud state.
        await new Promise(r=>setTimeout(r, 150 + Math.random()*250));
        guardRow = await readGuardRow();
        if(!guardRow) break;
      }
      if(ok) {
        const now = new Date().toISOString();
        lastPushTs.current = now;
        DB.set("lastPushTs", now);
        pendingPush.current = false;
      }
      setSyncStatus(ok ? "synced" : "error");
      return !!ok;
    } catch { setSyncStatus("error"); return false; }
    finally { syncLock.current = false; }
  }, [doPull]);

  // ── SHIFT LIST SYNC — merge-safe, not whole-row overwrite ──
  // active_shifts can have several DEVICES each starting/ending their own
  // entry around the same time (a store with multiple registers). A
  // plain doPush (last write wins on the entire row) risks silently
  // dropping another device's shift the exact same way the old
  // stores.devices race did earlier — see registerDevice's own comment
  // for the original version of this problem. This re-reads the cloud's
  // current list immediately before writing, applies just this one
  // change on top of that fresh read, and writes back only this field —
  // not the whole row — so two devices touching DIFFERENT entries at
  // nearly the same moment can't clobber each other. mutateFn receives
  // the latest known list and returns the new list.
  const syncShiftEntry = useCallback(async (mutateFn) => {
    const lic = getLicense();
    if(!lic?.storeId) return null;
    const MAX_ATTEMPTS = 4;
    for(let attempt=0; attempt<MAX_ATTEMPTS; attempt++){
      const cloudRow = await supa.get("store_data", {store_id:lic.storeId}, "active_shifts,updated_at");
      // Same wipe guard as syncArrayFieldOptimistic: a failed READ must
      // never turn into a write. The old fallback to the local copy could
      // push a stale local list over a fresher cloud one whenever the read
      // flaked but the write went through.
      if(!cloudRow){ await new Promise(r=>setTimeout(r, 250*(attempt+1) + Math.random()*250)); continue; }
      const updated = mutateFn(cloudRow.active_shifts ?? []);
      const result = await supa.updateGuarded("store_data", {store_id:lic.storeId},
        {active_shifts: updated, updated_at: new Date().toISOString()},
        {updated_at: cloudRow.updated_at});
      if(result.ok){
        setActiveShifts(updated);
        DB.set("activeShifts", updated);
        return updated;
      }
      await new Promise(r=>setTimeout(r, 150 + Math.random()*250));
    }
    console.error("[Sync] Could not persist shift change after retries — likely a connectivity issue.");
    return null;
  }, []);

  // ── OPTIMISTIC MERGE-SAFE SYNC — for customers/loyaltyRewards ──
  // Same underlying problem syncShiftEntry solves (two devices touching
  // the same shared list at once, whole-row push risking one silently
  // dropping the other's change) — but shift start/end is a rare,
  // deliberate action where waiting a beat for the network is fine.
  // Crediting loyalty points happens on every single sale, and checkout
  // speed matters — nobody should feel the app pause because a customer
  // happened to be selected. So this updates the UI immediately from
  // local state, then reconciles with the cloud in the background:
  // fetches the CLOUD's current list, re-applies the SAME mutation to
  // THAT (not to the local snapshot), and corrects local state if the
  // true merged result differs — e.g. another device's change landed
  // in between. mutateFn must be relative ("add 5 points to whoever
  // has this id"), never absolute ("set to exactly 105") — the same
  // function gets replayed against two different starting arrays and
  // needs to produce the right answer against either one.
  const syncArrayFieldOptimistic = useCallback((fieldKey, dbKey, mutateFn, localSetter) => {
    localSetter(prevLocal => {
      const optimistic = mutateFn(prevLocal);
      DB.set(dbKey, optimistic);
      return optimistic;
    });
    (async () => {
      const lic = getLicense();
      if(!lic?.storeId) return;
      const MAX_ATTEMPTS = 4;
      for(let attempt=0; attempt<MAX_ATTEMPTS; attempt++){
        const cloudRow = await supa.get("store_data", {store_id:lic.storeId}, `${fieldKey},updated_at`);
        // ── WIPE GUARD ── supa.get returns null BOTH when the row doesn't
        // exist and when the request simply failed (timeout, flaky wifi,
        // 5xx). The old code treated either as "cloud has []" and happily
        // PATCHed mutateFn([]) over the real cloud array — one unlucky
        // failed read with a working write and every customer / booking /
        // reward in the cloud was gone, then pulled as gone by every other
        // device. Never write after a failed read: retry the read, and if
        // it never succeeds, keep the optimistic local copy and let doPush
        // (whose payload union-merges this field against the cloud's copy)
        // carry it up once connectivity returns.
        if(!cloudRow){ await new Promise(r=>setTimeout(r, 250*(attempt+1) + Math.random()*250)); continue; }
        const merged = mutateFn(cloudRow[fieldKey] ?? []);
        // ── COMPARE-AND-SWAP ── guarded on the updated_at we just read, so
        // a write from another device (or the public booking API) landing
        // between our read and our write can no longer be silently
        // overwritten — the guard misses, and we loop back to re-read the
        // fresh cloud state and re-apply the mutation on top of THAT.
        // Same pattern create-booking.js has used in production.
        const result = await supa.updateGuarded("store_data", {store_id:lic.storeId},
          {[fieldKey]: merged, updated_at: new Date().toISOString()},
          {updated_at: cloudRow.updated_at});
        if(result.ok){
          localSetter(merged);
          DB.set(dbKey, merged);
          return;
        }
        await new Promise(r=>setTimeout(r, 150 + Math.random()*250));
      }
      // Local copy is still correct — flag a pending push so the next
      // doPush (which union-merges these fields, never blind-overwrites)
      // reconciles it with the cloud once the connection recovers.
      pendingPush.current = true;
      console.error(`[Sync] Could not persist ${fieldKey} change after retries — likely a connectivity issue. Local copy is still correct; will reconcile on next successful push.`);
    })();
  }, []);
  const syncCustomerEntry = useCallback((mutateFn) => {
    syncArrayFieldOptimistic("customers", "customers", mutateFn, setCustomers);
  }, [syncArrayFieldOptimistic]);
  const syncRewardEntry = useCallback((mutateFn) => {
    syncArrayFieldOptimistic("loyalty_rewards", "loyaltyRewards", mutateFn, setLoyaltyRewards);
  }, [syncArrayFieldOptimistic]);
  // Bookings need this more than almost anything else synced this way —
  // double-booking prevention IS the feature. Two staff on two devices
  // could each honestly check their own local view, see a slot open, and
  // both book it; a plain whole-row push could let that happen silently.
  const syncBookingEntry = useCallback((mutateFn) => {
    syncArrayFieldOptimistic("bookings", "bookings", mutateFn, setBookings);
  }, [syncArrayFieldOptimistic]);

  // Full sync = pull then push (used on first load)
  const doSync = useCallback(async () => {
    await doPull();
    if(pendingPush.current) await doPush();
  }, [doPull, doPush]);

  // Start background pull every 5 minutes (passive — just checking for portal changes)
  // Push only happens when triggerSync() is called after real user actions
  useEffect(()=>{
    if(!activated) return;
    // Compress any existing large images in background (one-time migration)
    setTimeout(migrateProductImages, 3000);
    // Initial full sync on load
    doPull().then(()=>{
      // ── ONE-TIME MIGRATION — ensure built-in Dine-in / Take-out are always present ──
      setOrderSettings(prev=>{
        const types = prev.orderTypes || [];
        const BUILT_INS = [
          { id:"ot1", label:"Dine-in",  enabled:false, locked:true },
          { id:"ot2", label:"Take-out", enabled:false, locked:true },
        ];
        const hasOt1 = types.some(t=>t.id==="ot1");
        const hasOt2 = types.some(t=>t.id==="ot2");
        const needsPatch = !hasOt1 || !hasOt2 || types.some(t=>(t.id==="ot1"||t.id==="ot2")&&!t.locked);
        if(!needsPatch) return prev;
        const withBuiltIns = [
          ...BUILT_INS.filter(bi=>!types.some(t=>t.id===bi.id)),
          ...types.map(t=>(t.id==="ot1"||t.id==="ot2")?{...t,locked:true}:t),
        ];
        const patched = {
          ...prev,
          orderTypes: withBuiltIns,
          customerNumMode: prev.customerNumMode || "per_shift",
        };
        DB.set("orderSettings", patched);
        pendingPush.current = true;
        return patched;
      });
      // ── ONE-TIME MIGRATION — backfill shift_exempt onto existing Owner/Programmer roles ──
      // shift_exempt was added after many stores already had role_owner/role_programmer
      // saved without it (without it, the cloud's "roles" array — pulled just above —
      // wouldn't have it either, and Owner would suddenly start requiring a shift,
      // which is a real regression nobody asked for). Running this AFTER doPull
      // resolves (not in a parallel effect) guarantees it always applies on top of
      // whatever just came from the cloud, instead of racing with it and losing.
      setRoles(prevRoles=>{
        let changed=false;
        const migrated=prevRoles.map(r=>{
          if((r.id==="role_owner"||r.id==="role_programmer") && !r.permissions?.includes("shift_exempt")){
            changed=true;
            return {...r, permissions:[...(r.permissions||[]), "shift_exempt"]};
          }
          return r;
        });
        if(changed){ pendingPush.current = true; }
        return changed ? migrated : prevRoles;
      });
      // ── ONE-TIME MIGRATION — backfill settings_scanner_printer onto the
      // existing Staff role, same reasoning as shift_exempt above: stores
      // that already had role_staff saved before this permission existed
      // would otherwise never pick it up, and staff would stay locked out
      // of Settings entirely — unable to even reconnect a printer for
      // their own shift without asking an owner/manager to do it. ──
      setRoles(prevRoles=>{
        let changed=false;
        const migrated=prevRoles.map(r=>{
          if(r.id==="role_staff" && !r.permissions?.includes("settings_scanner_printer")){
            changed=true;
            return {...r, permissions:[...(r.permissions||[]), "settings_scanner_printer"]};
          }
          return r;
        });
        if(changed){ pendingPush.current = true; }
        return changed ? migrated : prevRoles;
      });
      // ── ONE-TIME MIGRATION — backfill loyalty onto existing Owner/Manager/
      // Staff roles. Same reasoning as settings_scanner_printer above: this
      // permission gates a counter-level task (redeeming a reward for a
      // customer), not a back-office one, so it should be broadly available
      // by default — stores that already had these roles saved before this
      // permission existed would otherwise never pick it up.
      setRoles(prevRoles=>{
        let changed=false;
        const migrated=prevRoles.map(r=>{
          if((r.id==="role_owner"||r.id==="role_manager"||r.id==="role_staff") && !r.permissions?.includes("loyalty")){
            changed=true;
            return {...r, permissions:[...(r.permissions||[]), "loyalty"]};
          }
          return r;
        });
        if(changed){ pendingPush.current = true; }
        return changed ? migrated : prevRoles;
      });
      // ── ONE-TIME MIGRATION — backfill bookings onto existing Owner/
      // Manager/Staff roles, same reasoning as loyalty above.
      setRoles(prevRoles=>{
        let changed=false;
        const migrated=prevRoles.map(r=>{
          if((r.id==="role_owner"||r.id==="role_manager"||r.id==="role_staff") && !r.permissions?.includes("bookings")){
            changed=true;
            return {...r, permissions:[...(r.permissions||[]), "bookings"]};
          }
          return r;
        });
        if(changed){ pendingPush.current = true; }
        return changed ? migrated : prevRoles;
      });
      // ── ONE-TIME MIGRATION — backfill new permissions onto existing roles ──
      setRoles(prevRoles=>{
        let changed=false;
        const migrated=prevRoles.map(r=>{
          const perms=r.permissions||[];
          const toAdd=[];
          // Owner gets all new perms
          if((r.id==="role_owner"||r.id==="role_programmer")){
            if(!perms.includes("orders_add_manual")) toAdd.push("orders_add_manual");
            if(!perms.includes("reports_expenses_view")) toAdd.push("reports_expenses_view");
            if(!perms.includes("reports_expenses_manage")) toAdd.push("reports_expenses_manage");
          }
          // Manager gets view expenses only
          if(r.id==="role_manager"){
            if(!perms.includes("reports_expenses_view")) toAdd.push("reports_expenses_view");
          }
          if(toAdd.length>0){ changed=true; return {...r, permissions:[...perms,...toAdd]}; }
          return r;
        });
        if(changed){ pendingPush.current = true; }
        return changed ? migrated : prevRoles;
      });
      if(pendingPush.current) doPush();
    });

      // ── ONE-TIME MIGRATION — backfill po_approve + PO tab perms onto existing roles ──
      setRoles(prevRoles=>{
        let changed=false;
        const migrated=prevRoles.map(r=>{
          const perms=r.permissions||[];
          const toAdd=[];
          const PO_TAB_PERMS=["po_approve","po_receive","po_pay","po_view_all","po_suppliers","po_payments","po_reports"];
          if(r.id==="role_owner"||r.id==="role_programmer"){
            if(!perms.includes("purchase_orders")) toAdd.push("purchase_orders");
            PO_TAB_PERMS.forEach(p=>{ if(!perms.includes(p)) toAdd.push(p); });
          }
          if(r.id==="role_manager"){
            if(!perms.includes("purchase_orders")) toAdd.push("purchase_orders");
            PO_TAB_PERMS.forEach(p=>{ if(!perms.includes(p)) toAdd.push(p); });
          }
          if(toAdd.length>0){ changed=true; return {...r, permissions:[...perms,...toAdd]}; }
          return r;
        });
        if(changed){ pendingPush.current=true; }
        return changed ? migrated : prevRoles;
      });
      if(pendingPush.current) doPush();

    // Passive pull every 60s — was 5 minutes, but that's a long wait for
    // anything genuinely multi-device (Open Bills especially: the whole
    // point is one counter creating a bill another counter picks up
    // soon after). This still pulls the WHOLE store_data row each time,
    // same as before, just more often — a real-time subscription would
    // be the more efficient long-term fix if this interval ever needs
    // to go tighter still, but a REST poll every 60s is cheap enough
    // for a small store's realistic device count and order volume.
    syncRef.current = setInterval(doPull, 60 * 1000);
    // Suspension gets its own much tighter interval — a single cheap
    // status-field check, not a full sync — so getting locked out for
    // non-payment feels close to immediate instead of "whenever the next
    // 5-minute sync happens to land."
    const suspensionInterval = setInterval(checkSuspension, 20 * 1000);
    checkSuspension(); // also check once immediately on load, don't wait for the first tick

    // ── PORTAL CHANGE DETECTOR ──
    // Every 30 seconds, check only the updated_at timestamp (~1KB request)
    // If portal added products, removed device, changed settings etc — pull immediately
    //
    // Also checks stores.devices for another device's recent last_seen_at
    // (already updated on every pull by registerDevice — no new write
    // happening here, just reading it) to detect whether a second device
    // is actively in use right now. When one is, the next check is
    // scheduled sooner (~10s) instead of the default 30s, so changes
    // between two devices on the same store propagate quickly during an
    // active session. A single-device store never sees this tighten —
    // it stays at the normal 30s cadence, so this adds no extra load for
    // what's presumably the common case.
    let otherDeviceActive = false;
    const checkPortalChanges = async () => {
      const lic = getLicense();
      if(!lic?.storeId || syncLock.current) return;
      try {
        const [dataRes, storeRes] = await Promise.all([
          fetch(`${SUPA_URL}/rest/v1/store_data?store_id=eq.${lic.storeId}&select=updated_at&limit=1`,
            { headers: { "apikey": SUPA_ANON, "Authorization": `Bearer ${SUPA_ANON}` } }),
          fetch(`${SUPA_URL}/rest/v1/stores?id=eq.${lic.storeId}&select=devices&limit=1`,
            { headers: { "apikey": SUPA_ANON, "Authorization": `Bearer ${SUPA_ANON}` } }),
        ]);
        if(dataRes.ok) {
          const [row] = await dataRes.json();
          if(row) {
            const cloudTs = row.updated_at || "0";
            const myTs    = lastPushTs.current || "0";
            // Portal changed something — pull full data immediately
            if(cloudTs > myTs) {
              await doPull();
            }
          }
        }
        // Retry a pending push on every check, not only when a cloud
        // change also happened to be detected above. If an earlier push
        // attempt failed (a transient network blip is enough), nothing
        // else was guaranteed to ever retry it — and since doPull()
        // refuses to apply cloud data while a push is still pending (see
        // its own comment for why), a single failed push with no retry
        // would otherwise permanently strand a device on stale local
        // data, even though the cloud side is completely fine. Calling
        // doPush() here is safe even when nothing is actually pending —
        // it's a no-op check against pendingPush.current either way.
        if(pendingPush.current) await doPush();
        if(storeRes.ok) {
          const [storeRow] = await storeRes.json();
          const devices = storeRow?.devices || [];
          const now = Date.now();
          otherDeviceActive = devices.some(d =>
            d.id !== DEVICE_ID && d.last_seen_at && (now - new Date(d.last_seen_at).getTime()) < 90 * 1000
          );
        }
      } catch {}
    };
    let portalCheckTimeoutId = null;
    const scheduleNextPortalCheck = () => {
      const delay = otherDeviceActive ? 10 * 1000 : 30 * 1000;
      portalCheckTimeoutId = setTimeout(async () => {
        await checkPortalChanges();
        scheduleNextPortalCheck();
      }, delay);
    };
    scheduleNextPortalCheck();

    // ── WAKE-UP CATCH-UP ──
    // Browsers throttle or fully suspend setInterval timers once a tab is
    // backgrounded or a device's screen locks — this is standard browser
    // power management, not something the app controls. A "monitoring"
    // device sitting idle on a shelf hits this far more than an actively
    // used POS terminal, since it's rarely the focused/foreground tab.
    // Without this, such a device can silently stop syncing for however
    // long it was backgrounded, then wait for whatever delayed interval
    // tick the browser decides to resume on — not the intended 30s. This
    // forces an immediate check the moment the tab/device becomes visible
    // again, rather than waiting on a timer that may have been paused.
    const handleVisibilityChange = () => {
      if(document.visibilityState === "visible") {
        checkPortalChanges();
        checkSuspension();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return ()=>{
      clearInterval(syncRef.current); clearTimeout(portalCheckTimeoutId); clearInterval(suspensionInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  },[activated, doPull, doPush]);

  // ── triggerSync — called after important user actions ──
  // Debounced 2s so rapid actions (adding multiple items) batch into one push
  const syncDebounce = useRef(null);
  const triggerSync = useCallback(()=>{
    pendingPush.current = true;
    setSyncStatus("syncing");
    clearTimeout(syncDebounce.current);
    syncDebounce.current = setTimeout(doPush, 2000);
  },[doPush]);
  // Sync is triggered by: 1) 5min passive pull, 2) explicit triggerSync() after user actions
  // Do NOT trigger sync automatically on every state change — causes infinite loops

  // ── ONLINE / OFFLINE — browser connectivity listener ──
  // Flips syncStatus immediately on connectivity changes and fires an
  // automatic push the moment we come back online, so anything queued
  // while offline flushes without waiting on the 5-min passive pull.
  const [justCameOnline,setJustCameOnline] = useState(false);
  const backOnlineTimer = useRef(null);
  useEffect(()=>{
    const handleOnline = ()=>{
      pendingPush.current = true;
      setSyncStatus("syncing");
      setJustCameOnline(true);
      doPush();
      clearTimeout(backOnlineTimer.current);
      backOnlineTimer.current = setTimeout(()=>setJustCameOnline(false), 6000);
    };
    const handleOffline = ()=>{
      setSyncStatus("offline");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return ()=>{
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearTimeout(backOnlineTimer.current);
    };
  },[doPush]);



  const notify=useCallback((msg,type="success")=>{clearTimeout(toastRef.current);setToast({msg,type});toastRef.current=setTimeout(()=>setToast(null),2800);},[]);

  const tryLogout=()=>{
    // Staff/Manager can't logout with active shift
    if(activeShift && !isOwnerOrAdmin){
      setLogoutWarning(true);
      return;
    }
    setSession(null);setView("pos");
    log("LOGIN","logout",`${session?.name} logged out — ${getLicense()?.deviceName||"Unknown Device"}`);
  };
  // Force logout — bypasses active shift check (used after shift is ended)
  const forceLogout=()=>{
    setSession(null);setView("pos");
    log("LOGIN","logout",`${session?.name} logged out after shift ended — ${getLicense()?.deviceName||"Unknown Device"}`);
  };
  const logout=tryLogout; // alias

  const isProgrammer=session?.roleId==="role_programmer" || session?.id==="acc_programmer";

  // Once installed as a standalone app (not just open in a regular
  // browser tab), disable the right-click context menu — this is meant
  // to stop a cashier from accidentally right-clicking mid-shift into a
  // confusing browser menu (Inspect, View Source, Reload, etc.), not a
  // real security measure — anyone who knows a keyboard shortcut like
  // F12 can still reach dev tools regardless. The developer/programmer
  // account is exempted so support/debugging isn't blocked by this.
  useEffect(()=>{
    if(!isInstalledPWA() || isProgrammer) return;
    const block = (e) => e.preventDefault();
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  },[isProgrammer]);

  const allAccountsForProgrammer=[...accounts,PROGRAMMER];
  const currentRole=session?roles.find(r=>r.id===session.roleId):null;
  const can=(perm)=>{if(session?.id==="acc_programmer")return true;return currentRole?.permissions?.includes(perm)??false;};

  // Handle activation complete — optionally restore data from cloud
  const handleActivated = useCallback(async ({store, data, requireLogin=false})=>{
    // Check if this is a DIFFERENT store than what was previously on this device
    const prevLicense = getLicense();
    const isDifferentStore = prevLicense?.storeId && store?.id && prevLicense.storeId !== store.id;
    if(isDifferentStore) {
      // Different store detected — wipe old store data from the active backend only.
      // During a dev-support session this clears sessionStorage (this tab only);
      // for a real device it clears localStorage exactly as before.
      const backend = isDevSupportSession() ? sessionStorage : localStorage;
      STORE_DATA_KEYS.forEach(k => { try { backend.removeItem("pospro_" + k); } catch {} });
    }

    if(data){
      // Restore all data from cloud
      if(data.products?.length)     { setProducts(data.products);       DB.set("products",data.products); }
      if(data.orders?.length)       { setOrders(data.orders);           DB.set("orders",data.orders); }
      if(data.shifts?.length)       { setShifts(data.shifts);           DB.set("shifts",data.shifts); }
      if(data.accounts?.length)     { setAccounts(data.accounts);       DB.set("accounts",data.accounts); }
      if(data.categories?.length)   { setCategories(data.categories);   DB.set("categories",data.categories); }
      if(data.roles?.length)        { setRoles(data.roles);             DB.set("roles",data.roles); }
      if(data.theme?.primary)       { setTheme(data.theme);             DB.set("theme",data.theme); }
      if(data.sku_settings?.prefix) { setSku(data.sku_settings);        DB.set("skuSettings",data.sku_settings); }
      if(data.order_settings)       { setOrderSettings(data.order_settings); DB.set("orderSettings",data.order_settings); }
      if(data.ui_settings && Object.keys(data.ui_settings).length) { setUiSettings(data.ui_settings); DB.set("uiSettings",data.ui_settings); }
      if(Array.isArray(data.active_shifts))   { setActiveShifts(data.active_shifts); DB.set("activeShifts",data.active_shifts); }
      else if(data.active_shift)              { setActiveShifts([data.active_shift]); DB.set("activeShifts",[data.active_shift]); }
      if(data.logs)                    { setLogs(data.logs);               DB.set("logs",data.logs); }
      // These previously never round-tripped through the cloud at all —
      // each device/session silently kept whatever was last in its own
      // local storage. Explicit defaults here (not `?.length` guards)
      // because a store with PO/Invoice OFF, or zero suppliers, is a
      // perfectly valid real state that must overwrite stale local data —
      // not be skipped the way an empty/missing cloud value would be.
      setSuppliers(data.suppliers||[]);                 DB.set("suppliers", data.suppliers||[]);
      setPOs(data.purchase_orders||[]);                 DB.set("purchaseOrders", data.purchase_orders||[]);
      setCustomers(data.customers||[]);                 DB.set("customers", data.customers||[]);
      setInvoices(data.invoices||[]);                   DB.set("invoices", data.invoices||[]);
      setStoreExpenses(data.store_expenses||[]);         DB.set("storeExpenses", data.store_expenses||[]);
      setCountSessions(data.count_sessions||[]);         DB.set("countSessions", data.count_sessions||[]);
      setLoyaltyRewards(data.loyalty_rewards||[]);       DB.set("loyaltyRewards", data.loyalty_rewards||[]);
      setBookingResources(data.booking_resources||[]);   DB.set("bookingResources", data.booking_resources||[]);
      setBookingPageContent(data.booking_page_content||[]); DB.set("bookingPageContent", data.booking_page_content||[]);
      setBookingPageSettings(data.booking_page_settings||{}); DB.set("bookingPageSettings", data.booking_page_settings||{});
      setBookingServices(data.booking_services||[]);     DB.set("bookingServices", data.booking_services||[]);
      setBookings(data.bookings||[]);                    DB.set("bookings", data.bookings||[]);
      setBusinessDetails(data.business_details||null);  DB.set("businessDetails", data.business_details||null);
      setEnablePO(!!data.enable_po);                     DB.set("enablePO", !!data.enable_po);
      setEnableInvoice(!!data.enable_invoice);            DB.set("enableInvoice", !!data.enable_invoice);
      setEnableLoyalty(!!data.enable_loyalty);            DB.set("enableLoyalty", !!data.enable_loyalty);
      setEnableBookings(!!data.enable_bookings);          DB.set("enableBookings", !!data.enable_bookings);
      { const km = data.kitchen_module_enabled !== undefined ? !!data.kitchen_module_enabled : !!(data.order_settings?.enableKitchenTicket);
        setKitchenModuleEnabled(km); DB.set("kitchenModuleEnabled", km); }
      { const ob = data.open_bills_module_enabled !== undefined ? !!data.open_bills_module_enabled : !!(data.order_settings?.enableOpenBills);
        setOpenBillsModuleEnabled(ob); DB.set("openBillsModuleEnabled", ob); }
      DB.set("allowScreenshots", !!data.allow_screenshots);
    } else if(store){
      // Fresh activation — hash the owner password before storing it locally
      const plainPw = store.owner_password || "";
      const hashedPw = plainPw.startsWith("$2") ? plainPw : await bcrypt.hash(plainPw, 10);
      const ownerAcc = {
        id:       "acc_owner",
        name:     store.owner_name || "Owner",
        username: store.owner_username || "owner",
        password: hashedPw,
        roleId:   "role_owner",
        active:   true,
        phone:"", address:"", email: store.owner_email||"", notes:"",
      };
      const initAccounts = [ownerAcc];
      setAccounts(initAccounts); DB.set("accounts", initAccounts);
      // Apply store name to theme
      const updTheme={...DB.get("theme",DEFAULT_THEME), storeName: store.store_name||"My Store"};
      setTheme(updTheme); DB.set("theme", updTheme);

      // Trial stores get full access to Open Bills, Purchase Orders,
      // Invoices, and Kitchen Order Ticket to try everything during the
      // trial — the server already set these the same way the moment
      // the store was created. Mirroring that here too matters because
      // this device's own push right below sends its own order_settings
      // (built from empty local storage on a brand-new device) as a
      // whole-object upsert — without this, that push would silently
      // overwrite what the server just set with an empty value.
      //
      // Open Bills specifically is two-tier, same as Kitchen Ticket:
      // openBillsModuleEnabled controls whether it's AVAILABLE at all
      // (trial-conditional, set here); order_settings.enableOpenBills is
      // the store's own preference for whether they actually want to
      // use it — that one stays at its normal off-by-default value even
      // during a trial, so a trial owner still has to opt in from
      // Settings rather than finding it silently switched on for them.
      const isTrial = store.plan === "trial";
      setEnablePO(isTrial); DB.set("enablePO", isTrial);
      setEnableInvoice(isTrial); DB.set("enableInvoice", isTrial);
      setKitchenModuleEnabled(isTrial); DB.set("kitchenModuleEnabled", isTrial);
      setOpenBillsModuleEnabled(isTrial); DB.set("openBillsModuleEnabled", isTrial);
      const initOrderSettings = DB.get("orderSettings", {});

      if(store.id) {
        const initPayload = {
          accounts:       initAccounts,
          products:       DB.get("products",      []),
          orders:         DB.get("orders",        []),
          categories:     DB.get("categories",    []),
          roles:          DB.get("roles",         []),
          theme:          updTheme,
          sku_settings:   DB.get("skuSettings",   {}),
          order_settings: initOrderSettings,
          shifts:         [],
          logs:           [],
          active_shift:   null,
          enable_po:                 isTrial,
          enable_invoice:            isTrial,
          kitchen_module_enabled:    isTrial,
          open_bills_module_enabled: isTrial,
        };
        pushToCloud(store.id, initPayload).catch(()=>{});
      }
    }
    setLicenseState(getLicense());
    // Save to multi-store registry so this store appears in the switcher next time
    if (store?.owner_email && store?.store_name) {
      saveRegisteredStore(store.owner_email, store.store_name);
    }
    setActivated(true);
    // If requireLogin is set, don't restore session — force user to log in
    if(requireLogin) setSession(null);
  },[]);

  // ── DEV CONSOLE IMPERSONATION — handle ?devtoken= on load ──
  // Validates the token, registers a temporary "Dev Support" device,
  // pulls that store's live data, and auto-logs in as the Developer
  // account — skipping both the Sign In screen and the red Developer
  // Access password popup entirely.
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const devtoken = params.get("devtoken");
    if(!devtoken) return;
    (async()=>{
      const storeId = await verifyDevToken(devtoken);
      // Strip the token from the URL immediately — never bookmarkable/shareable
      window.history.replaceState({}, "", window.location.pathname);
      if(!storeId){ setDevTokenChecking(false); return; }

      const store = await supa.get("stores",{id:storeId},"id");
      if(!store){ setDevTokenChecking(false); return; }

      await addDeviceToStore(storeId, "Dev Support", "Developer Access");
      const data = await pullFromCloud(storeId);

      // Mark this browser tab as a dev-support session (sessionStorage only)
      sessionStorage.setItem("pospro_dev_support", "1");
      setDevSupportMode(true);

      // saveLicense() was missing here — handleActivated() only ever READS
      // the license via getLicense(), it never creates one. Every normal
      // activation path creates the license object itself before calling
      // handleActivated, but the devtoken flow skipped that step entirely,
      // leaving getLicense() returning null for the rest of the session —
      // which is why doPush (and therefore Module Settings save) always
      // failed silently with "no valid license/storeId found".
      saveLicense({
        storeId: store.id,
        email: "dev-console",
        storeName: store.store_name,
        ownerName: store.owner_name,
        deviceName: "Dev Support",
        activatedAt: new Date().toISOString(),
      });

      await handleActivated({store, data});
      setSession({...PROGRAMMER});
      setView("pos");
      setDevTokenChecking(false);
    })();
  },[handleActivated]);

  // ── DEV SUPPORT — auto-expire after 30 minutes, or manual End Session ──
  const endDevSession = useCallback(async()=>{
    setEndingSession(true);
    // Push any local-only changes (e.g. module settings saved but not yet
    // synced) before wiping this tab's data — a dev-support tab only ever
    // holds sessionStorage, so once this clears, anything unpushed is gone.
    //
    // doPush silently no-ops if syncLock is already held by an in-flight
    // doPull/doPush (e.g. the 5-min passive pull, or the 2s debounce timer
    // from a Save button click that hasn't fired yet) — so wait briefly
    // for the lock to clear before forcing the final push, instead of
    // letting it fail silently and lose the unsaved change.
    const waitForLock = async (maxMs) => {
      const start = Date.now();
      while (syncLock.current && Date.now() - start < maxMs) {
        await new Promise(r => setTimeout(r, 150));
      }
    };
    await waitForLock(4000);
    try { await doPush(); } catch {}
    const lic = getLicense();
    if(lic?.storeId){
      const s = await supa.get("stores",{id:lic.storeId},"id,devices");
      if(s){
        const cleaned = (s.devices||[]).filter(d=>d.id!==DEVICE_ID || d.name!=="Dev Support");
        await supa.update("stores",{id:lic.storeId},{devices:cleaned},{minimal:true});
      }
    }
    sessionStorage.removeItem("pospro_dev_support");
    sessionStorage.removeItem("pospro_session");
    STORE_DATA_KEYS.forEach(k => { try { localStorage.removeItem("pospro_" + k); } catch {} });
    try { localStorage.removeItem("pospro_license"); } catch {}
    window.location.href = window.location.pathname;
  },[doPush]);

  useEffect(()=>{
    if(!devSupportMode) return;
    const t = setTimeout(endDevSession, 30*60*1000); // 30 minutes
    return ()=>clearTimeout(t);
  },[devSupportMode, endDevSession]);

  const canAccessSettings = can("settings")||can("settings_scanner_printer");
  const NAV=[
    {id:"dashboard",icon:"ti-layout-dashboard",label:"Dashboard",perm:"sales_all"},
    {id:"pos",      icon:"ti-shopping-cart",label:"POS",      perm:"pos"},
    {id:"orders",   icon:"ti-receipt",      label:"Orders",   perm:"orders_view"},
    {id:"inventory",icon:"ti-box",          label:"Inventory",perm:"inventory_view"},
    ...(enablePO      ?[{id:"po",      icon:"ti-truck",         label:"Purchase",  perm:"purchase_orders"}]:[]),
    ...(enableInvoice ?[{id:"invoice", icon:"ti-file-invoice",  label:"Invoices",  perm:"invoices"}]:[]),
    ...(enableLoyalty ?[{id:"loyalty", icon:"ti-gift",          label:"Loyalty",   perm:"loyalty"}]:[]),
    ...(enableBookings ?[{id:"bookings", icon:"ti-calendar-event", label:"Bookings", perm:"bookings"}]:[]),
    {id:"reports",  icon:"ti-chart-bar",    label:"Reports",  perm:"sales_today"},
    {id:"users",    icon:"ti-users",        label:"Users",    perm:"manage_users"},
    {id:"settings", icon:"ti-settings",     label:"Settings", perm:"settings"},
  ].filter(n=> n.id==="settings" ? canAccessSettings : can(n.perm));

  // Persist the current tab so a refresh lands back where the user was,
  // instead of always resetting to POS — a monitoring device sitting on
  // Dashboard shouldn't bounce back to POS every time the page reloads.
  useEffect(()=>{ DB.set("view", view); }, [view]);

  // Guard against a persisted view the CURRENT session can't actually
  // see — e.g. staff logging in on a device last used by the owner on
  // Dashboard, or a role's permissions changing since the last session.
  // Each view block below is independently permission-gated, so without
  // this, landing on a view the session can't access would just render
  // a blank main content area rather than falling back to something
  // valid. Logout already resets to "pos" on its own, so this is really
  // only for reload/first-load with a stale persisted value.
  useEffect(()=>{
    if(!session) return;
    if(!NAV.find(n=>n.id===view)) setView(NAV[0]?.id || "pos");
  }, [session, NAV.map(n=>n.id).join(",")]);

  const isMobile=bp==="mobile"; const sidebarW=bp==="desktop"?70:60;
  const themeCSS=`:root{--primary:${theme.primary};--sidebar:${theme.sidebar};--bg:${theme.bgColor};--radius:${theme.borderRadius}px;--font:${theme.fontFamily};}
@keyframes _fadeIn{from{opacity:0}to{opacity:1}}
@keyframes _slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes _slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
@keyframes _slideInBottom{from{opacity:0;transform:translateY(60px)}to{opacity:1;transform:translateY(0)}}
@keyframes _scaleIn{from{opacity:0;transform:scale(0.94)}to{opacity:1;transform:scale(1)}}
@keyframes _cartBump{0%{transform:scale(1)}40%{transform:scale(1.28)}100%{transform:scale(1)}}
@keyframes _toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
@media(prefers-reduced-motion:reduce){*{animation-duration:0.01ms!important;transition-duration:0.01ms!important}}
`;

  // Show activation screen if not licensed
  if(devTokenChecking) return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#0f0f1a",color:"#9ca3af",fontFamily:"sans-serif",fontSize:13}}>
      Verifying developer access…
    </div>
  );

  // ── SUSPENDED LOCK SCREEN ──
  // Unlike trial expiry, there's no "enter a code" self-service path out
  // of this one — a suspension is lifted by the developer reactivating
  // the license (typically after payment clears), not by the store doing
  // anything from their end. Same forced-logout treatment as trial
  // expiry, so a logged-in cashier can't keep working past it.
  if(activated && suspended){
    if(session){
      try { sessionStorage.removeItem("pospro_session"); } catch {}
    }
    return(
      <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#1a1a2e 0%,#16213e 60%,#0f3460 100%)",display:"flex",alignItems:"flex-start",justifyContent:"center",fontFamily:"sans-serif",padding:"20px 16px",overflowY:"auto"}}>
        <div style={{width:"100%",maxWidth:440,textAlign:"center",paddingTop:16,paddingBottom:24}}>
          <div style={{width:68,height:68,borderRadius:18,overflow:"hidden",margin:"0 auto 16px",boxShadow:"0 8px 32px rgba(220,38,38,0.5)"}}><img src="/icons/icon-192.png" alt="NJ POS" style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:18}}/></div>
          <div style={{fontFamily:"'Michroma',sans-serif",fontSize:20,letterSpacing:1,marginBottom:4}}><span style={{color:"#60A5FA"}}>NJ</span><span style={{color:"#fff"}}>POS</span></div>
          <div style={{fontFamily:"'Poppins',sans-serif",fontWeight:500,fontSize:10,color:"rgba(255,255,255,0.45)",marginBottom:24,letterSpacing:0.5}}>SMART POS. BETTER BUSINESS.</div>
          <div style={{background:"#fff",borderRadius:20,padding:"28px 24px",boxShadow:"0 24px 60px rgba(0,0,0,0.4)"}}>
            <div style={{fontSize:40,marginBottom:12}}>🔒</div>
            <div style={{fontWeight:800,fontSize:20,color:"#dc2626",marginBottom:8}}>Account Suspended</div>
            <div style={{fontSize:14,color:"#6b7280",marginBottom:20,lineHeight:1.6}}>
              Access to <b style={{color:"#111"}}>{license?.storeName||"this store"}</b> has been temporarily suspended.<br/>
              Your data is safe and untouched — please contact your NJ POS provider to resolve this.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── TRIAL LOCK SCREEN ──
  // Check both local license AND fetch live trial_expires_at from Supabase so even
  // a logged-in user gets locked out the moment the trial expires. The session is
  // cleared here so they can't bypass by refreshing without re-authenticating.
  if(activated && isTrialExpired(license)){
    // Force logout — clears the session so a logged-in user can't keep using the app
    if(session) {
      try { sessionStorage.removeItem("pospro_session"); } catch {}
    }
    // Send expiry email once (stored in localStorage to avoid repeat sends)
    if(!localStorage.getItem("trial_expiry_email_sent_"+license?.storeId)){
      fetch("https://owner.nj-systems.com/api/send-otp",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          email:license?.email,
          otp:"EXPIRED",
          storeName:license?.storeName,
          purpose:"trial_expired",
        })
      }).catch(()=>{});
      localStorage.setItem("trial_expiry_email_sent_"+license?.storeId,"1");
    }
    // If user clicked "Enter Activation Code", show ActivationScreen at the code step
    // with their email pre-filled so they skip straight to entering the paid code.
    // onActivated resets trialUnlocking first — the "Upgrade Now while trial is
    // still active" version of this same screen already did this; this one didn't,
    // which could leave this exact check (if(trialUnlocking)) still true on a
    // later render even after activation genuinely succeeded, sending the person
    // right back to this same code-entry screen instead of through to login.
    if(trialUnlocking){
      return(
        <><style>{themeCSS}</style>
        <ActivationScreen
          onActivated={(result)=>{ setTrialUnlocking(false); handleActivated(result); }}
          initialStep="code"
          initialEmail={license?.email||""}
        />
        </>
      );
    }
    return(
      <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#1a1a2e 0%,#16213e 60%,#0f3460 100%)",display:"flex",alignItems:"flex-start",justifyContent:"center",fontFamily:"sans-serif",padding:"20px 16px",overflowY:"auto"}}>
        <div style={{width:"100%",maxWidth:440,textAlign:"center",paddingTop:16,paddingBottom:24}}>
          <div style={{width:68,height:68,borderRadius:18,overflow:"hidden",margin:"0 auto 16px",boxShadow:"0 8px 32px rgba(37,99,235,0.5)"}}><img src="/icons/icon-192.png" alt="NJ POS" style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:18}}/></div>
          <div style={{fontFamily:"'Michroma',sans-serif",fontSize:20,letterSpacing:1,marginBottom:4}}><span style={{color:"#60A5FA"}}>NJ</span><span style={{color:"#fff"}}>POS</span></div>
          <div style={{fontFamily:"'Poppins',sans-serif",fontWeight:500,fontSize:10,color:"rgba(255,255,255,0.45)",marginBottom:24,letterSpacing:0.5}}>SMART POS. BETTER BUSINESS.</div>
          <div style={{background:"#fff",borderRadius:20,padding:"28px 24px",boxShadow:"0 24px 60px rgba(0,0,0,0.4)"}}>
            <div style={{fontSize:40,marginBottom:12}}>⏰</div>
            <div style={{fontWeight:800,fontSize:20,color:"#dc2626",marginBottom:8}}>Trial Expired</div>
            <div style={{fontSize:14,color:"#6b7280",marginBottom:20,lineHeight:1.6}}>
              Your 3-day free trial for <b style={{color:"#111"}}>{license?.storeName}</b> has ended.<br/>
              Your data is safe — contact us to continue.
            </div>
            <div style={{background:"#f5f3ff",border:"1px solid #c4b5fd",borderRadius:10,padding:"14px 16px",marginBottom:16,fontSize:13,color:"#5b21b6",textAlign:"left"}}>
              <div style={{fontWeight:800,marginBottom:6}}>To continue using NJ POS:</div>
              <div>1. Contact your NJ POS provider</div>
              <div>2. Purchase an activation code</div>
              <div>3. Enter the code below to unlock your store</div>
            </div>
            <div style={{fontSize:12,color:"#9ca3af",marginBottom:12}}>Already have a paid activation code?</div>
            <button onClick={()=>setTrialUnlocking(true)} style={{width:"100%",padding:"12px 0",background:"#2563EB",color:"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              <i className="ti ti-key" style={{fontSize:16}}/>Enter Activation Code
            </button>
          </div>
        </div>
      </div>
    );
  }

  if(!activated) return(<><style>{themeCSS}</style><ActivationScreen onActivated={handleActivated} initialEmail={switchToEmail||""} onCancel={switchToEmail?undefined:()=>{
    // Show loading overlay immediately
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:#0f172a;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;font-family:system-ui,sans-serif;";
    overlay.innerHTML = '<div style="width:48px;height:48px;border:4px solid rgba(255,255,255,0.2);border-top-color:#3b82f6;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:20px"></div><div style="color:#fff;font-size:15px;font-weight:700">Returning to your store...</div><div style="color:#64748b;font-size:12px;margin-top:8px">Syncing store data</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(overlay);
    // Restore from the backup saved before clearStoreData ran
    setTimeout(()=>{
      try{
        const backup = localStorage.getItem("pospro_license_backup");
        if(backup){
          localStorage.setItem("pospro_license", backup);
          sessionStorage.removeItem("pospro_license");
          localStorage.removeItem("pospro_license_backup");
        }
      }catch{}
      // Force hard reload to re-initialize all state from the restored license
      window.location.href = window.location.href.split("?")[0] + "?restored=" + Date.now();
    }, 800);
  }}/></> );

  // ── Store switching overlay — blocks UI during store switch ──
  if(isSwitchingStore) return(
    <div style={{position:"fixed",inset:0,background:"#fff",zIndex:99999,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20}}>
      <style>{`@keyframes _sw_spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <img src="/icons/icon-96.png" alt="NJ POS" style={{width:64,height:64,borderRadius:16,marginBottom:4}} onError={e=>{e.target.style.display="none";}}/>
      <div style={{fontSize:18,fontWeight:800,color:"#0f172a"}}>Switching Store…</div>
      <div style={{width:36,height:36,border:"3px solid #e5e7eb",borderTopColor:"#2563EB",borderRadius:"50%",animation:"_sw_spin 0.8s linear infinite"}}/>
      <div style={{fontSize:13,color:"#94a3b8"}}>Loading store data, please wait</div>
    </div>
  );

  // ── UPGRADE NOW (from active trial banner) ──
  // When user clicks "Upgrade Now" while trial is still active, show the
  // code entry screen directly — no need to wait for the trial to expire.
  if(trialUnlocking && !isTrialExpired(license)){
    return(
      <><style>{themeCSS}</style>
      <ActivationScreen
        onActivated={(result)=>{ setTrialUnlocking(false); handleActivated(result); }}
        initialStep="code"
        initialEmail={license?.email||""}
      />
      </>
    );
  }
  if(!session)   return(<><style>{themeCSS}</style>
    {crashRecovery&&<CrashRecoveryModal
      shift={crashRecovery.shift}
      shiftOrders={crashRecovery.shiftOrders}
      cashSales={crashRecovery.cashSales}
      estCloseCash={crashRecovery.estCloseCash}
      onClose={async(summary)=>{
        if(summary){
          const ended={...crashRecovery.shift,...summary,endTime:new Date().toLocaleString("en-PH"),status:"closed",closedBySystem:true};
          setShifts(prev=>[ended,...prev]);
          log("SHIFT","auto_close",`Shift auto-closed after crash/blackout — ${cashRecovery?.shift?.cashier}`);
        }
        const removedShiftId = crashRecovery.shift.id;
        setCrashRecovery(null);
        const result = await syncShiftEntry(current=>current.filter(s=>s.id!==removedShiftId));
        if(!result) console.error("[Shift] Crash-recovery cleanup couldn't reach the server — this shift may still show as active on other devices until the next successful sync.");
      }}
    />}
    <LoginScreen accounts={accounts} roles={roles} activeShifts={activeShifts} orders={orders} syncShiftEntry={syncShiftEntry} shifts={shifts} setShifts={setShifts} onSync={doPush} setAccounts={setAccounts} loginSettings={loginSettings}
      onSwitchStore={async (targetEmail)=>{
        if (!targetEmail) {
          // No email — just go to activation screen to add a new store
          const licBackup = getLicense();
          if(licBackup) {
            try{ localStorage.setItem("pospro_license_backup", JSON.stringify(licBackup)); }catch{}
          }
          clearStoreData();
          setProducts([]); setOrders([]); setAccounts([]); setCategories([]);
          setRoles([]); setShifts([]); setLogs([]); setActiveShifts([]);
          setSuppliers([]); setPOs([]); setCustomers([]);
          setInvoices([]); setStoreExpenses([]); setLoyaltyRewards([]);
          setBookings([]); setBookingResources([]); setBookingServices([]);
          setBusinessDetails(null); setTheme({}); setSession(null);
          setSwitchToEmail(null);
          setActivated(false);
          return;
        }
        // Check if this device is still registered to the target store
        const result = await supa.get("stores",{owner_email:targetEmail.trim().toLowerCase()},"id,owner_email,owner_name,owner_username,store_name,devices,max_devices,license_id,plan,created_at,last_seen_at");
        if (!result) {
          alert("Store not found. It may have been deleted.");
          return;
        }
        const devices = result.devices||[];
        const thisDevice = devices.find(d=>d.id===DEVICE_ID);
        if (!thisDevice) {
          // Device was removed by the owner — remove from local registry
          const {STORES_REGISTRY_KEY} = await import("./lib/storage.js");
          try {
            const reg = JSON.parse(localStorage.getItem(STORES_REGISTRY_KEY)||"[]");
            localStorage.setItem(STORES_REGISTRY_KEY, JSON.stringify(reg.filter(s=>s.email!==targetEmail.toLowerCase())));
          } catch {}
          alert("This device has been removed from that store by the account owner. It has been removed from your list.");
          return;
        }
        // Show loading overlay immediately to hide any flash of old store data
        setIsSwitchingStore(true);
        try {
        // Device is valid — wipe current store data and load new store
        clearStoreData();
        setProducts([]); setOrders([]); setAccounts([]); setCategories([]);
        setRoles(DEFAULT_ROLES); setShifts([]); setLogs([]); setActiveShifts([]);
        setSuppliers([]); setPOs([]); setCustomers([]);
        setInvoices([]); setStoreExpenses([]); setLoyaltyRewards([]);
        setBookings([]); setBookingResources([]); setBookingServices([]);
        setBusinessDetails(null); setTheme({}); setSession(null);
        // Pull cloud data and go directly to login
        const { pullFromCloud } = await import("./lib/sync.js");
        const data = await pullFromCloud(result.id);
        const licRow = result.license_id ? await supa.get("licenses",{id:result.license_id}) : null;
        saveLicense({
          storeId: result.id,
          email: targetEmail.trim().toLowerCase(),
          storeName: result.store_name,
          ownerName: result.owner_name,
          deviceName: thisDevice.name,
          plan: licRow?.plan||result.plan||null,
          activatedAt: new Date().toISOString(),
          trialExpiresAt: licRow?.trial_expires_at||licRow?.expires_at||null,
        });
        saveRegisteredStore(targetEmail, result.store_name);
        await handleActivated({store:result, data, requireLogin:true});
        // Small delay then hide overlay so login screen renders cleanly
        setTimeout(()=>setIsSwitchingStore(false), 400);
        } catch(e) {
          console.error("[StoreSwitch] Failed:", e);
          setIsSwitchingStore(false);
          alert("Failed to switch store. Please try again.");
        }
      }}
      onLogin={acc=>{
      setSession(acc);setView("pos");
      log("LOGIN","login",`${acc.name} (${roles.find(r=>r.id===acc.roleId)?.name||acc.roleId}) signed in — ${getLicense()?.deviceName||"Unknown Device"}`);
      // Best-effort — silently does nothing if the browser no longer treats
      // this click as "user-activated" (can happen after the awaited bcrypt
      // compare in LoginScreen on stricter browsers), or on platforms with
      // no real Fullscreen API support at all (notably iOS Safari). The
      // manual toggle in the sidebar covers both those cases.
      document.documentElement.requestFullscreen?.().catch(()=>{});
    }} theme={theme}/>
  </>);

  // ── SHIFT GATE — Staff/Manager must start shift before doing anything ──
  const shiftRequired = requiresShift();
  if(postShiftReport) return(
    <><style>{themeCSS}</style>
    <ShiftReportModal
      shift={postShiftReport.shift}
      orders={orders}
      orderSettings={orderSettings}
      storeName={theme?.storeName||"My Store"}
      doneLabel={postShiftReport.needsLogout?"Continue & Logout":"Done"}
      onClose={()=>{
        const needsLogout = postShiftReport.needsLogout;
        setPostShiftReport(null);
        if(needsLogout) setSession(null);
      }}
    /></>
  );
  if(shiftRequired) return(
    <><style>{themeCSS}</style>
    <div style={{minHeight:"100vh",background:"var(--bg)",fontFamily:"var(--font),sans-serif",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <style>{`@keyframes _njspin{to{transform:rotate(360deg)}}`}</style>
      <div style={{width:"100%",maxWidth:380,background:"#fff",borderRadius:20,padding:"32px 28px",boxShadow:"0 4px 20px rgba(0,0,0,0.08)",textAlign:"center"}}>
        <div style={{width:64,height:64,borderRadius:"50%",background:"#f0fdf4",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
          <i className="ti ti-clock" style={{fontSize:30,color:"#16a34a"}} aria-hidden="true"/>
        </div>
        <div style={{fontWeight:800,fontSize:18,marginBottom:6}}>Start Your Shift</div>
        <div style={{fontSize:13,color:"#6b7280",marginBottom:6}}>You must start a shift before you can use the POS.</div>
        <div style={{fontSize:12,color:"#9ca3af",marginBottom:24}}>Signed in as <b>{session.name}</b></div>
        <div style={{background:"#f9fafb",borderRadius:10,padding:"12px 16px",marginBottom:20,textAlign:"left",fontSize:12,color:"#6b7280"}}>
          <div style={{fontWeight:700,marginBottom:6,color:"#374151"}}>Enter your opening cash:</div>
          <ShiftStartInline
            session={session}
            busy={shiftStartBusy}
            onStart={async(openCash)=>{
              const lic=getLicense();
              const shift={id:"SFT-"+Date.now().toString(36).toUpperCase(),cashierId:session.id,cashier:session.name,deviceId:DEVICE_ID,deviceName:lic?.deviceName||"Unknown Device",startTime:new Date().toLocaleString("en-PH"),startDateKey:toLocalDateKey(new Date()),openCash,status:"active"};
              setShiftStartBusy(true);
              // Same reasoning as POSView's handleStartShift — dedupe by
              // deviceName too, not just deviceId, so a device-identity
              // change can't leave a phantom orphaned entry behind.
              const result = await syncShiftEntry(current=>[...current.filter(s=>s.deviceId!==DEVICE_ID&&s.deviceName!==shift.deviceName),shift]);
              setShiftStartBusy(false);
              if(!result){
                notify("Couldn't start the shift — check your connection and try again.","error");
                return;
              }
              log("SHIFT","start",`Shift started — Opening cash: ₱${openCash} — Device: ${shift.deviceName}`);
              notify(`Shift started — Opening: ₱${Number(openCash).toFixed(2)}`);
              setTimeout(()=>{ if(typeof doPush==="function") doPush(); }, 500);
            }}
          />
        </div>
        <button onClick={()=>{setSession(null);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"#9ca3af"}}>
          ← Sign out
        </button>
      </div>
    </div>
    </>
  );

  // ── SHIFT HANDOFF — a different staff logged in on top of an existing
  // active shift. Previously this fell straight through to the POS with
  // no acknowledgment at all: staff2 would silently start ringing up
  // sales under staff1's still-open shift/drawer, with the shift record
  // never reflecting who was actually running it from that point.
  // Per-order attribution was never actually broken (every order already
  // records its own cashier/cashierId independent of the shift), so a
  // handoff only needs to update who the shift ITSELF currently belongs
  // to — sales staff1 already made stay correctly credited to staff1.
  const needsHandoff = !shiftRequired && activeShift && activeShift.cashierId!==session.id && !isOwnerOrAdmin;
  if(needsHandoff){
    const mins = Math.floor((Date.now()-new Date(activeShift.startTime).getTime())/60000);
    const ago = mins<1?"just now":mins<60?`${mins}m ago`:`${Math.floor(mins/60)}h ${mins%60}m ago`;
    return(
      <><style>{themeCSS}</style>
      <div style={{minHeight:"100vh",background:"var(--bg)",fontFamily:"var(--font),sans-serif",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
        <div style={{width:"100%",maxWidth:380,background:"#fff",borderRadius:20,padding:"32px 28px",boxShadow:"0 4px 20px rgba(0,0,0,0.08)",textAlign:"center"}}>
          <div style={{width:64,height:64,borderRadius:"50%",background:"#fef3c7",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
            <i className="ti ti-users" style={{fontSize:30,color:"#d97706"}} aria-hidden="true"/>
          </div>
          <div style={{fontWeight:800,fontSize:18,marginBottom:6}}>Shift In Progress</div>
          <div style={{fontSize:13,color:"#374151",marginBottom:4}}><b>{activeShift.cashier}</b> has a shift open on this device — started {ago}.</div>
          <div style={{fontSize:12,color:"#9ca3af",marginBottom:24,lineHeight:1.5}}>Sales {activeShift.cashier} already made stay credited to them either way — this just hands the register to <b>{session.name}</b> going forward.</div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{setSession(null);}} style={{flex:1,padding:"11px 0",border:"1px solid #e5e7eb",borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:700,background:"#fff"}}>Cancel</button>
            <button disabled={shiftStartBusy} onClick={async()=>{
              const prevCashier=activeShift.cashier;
              setShiftStartBusy(true);
              const result = await syncShiftEntry(current=>current.map(s=>s.id===activeShift.id?{...s,cashier:session.name,cashierId:session.id}:s));
              setShiftStartBusy(false);
              if(!result){
                notify("Couldn't take over the shift — check your connection and try again.","error");
                return;
              }
              log("SHIFT","handoff",`Shift handed over: ${prevCashier} → ${session.name}`);
              notify(`You've taken over the shift from ${prevCashier}`);
            }} style={{flex:2,padding:"11px 0",background:shiftStartBusy?"#d1d5db":"#d97706",color:"#fff",border:"none",borderRadius:10,cursor:shiftStartBusy?"default":"pointer",fontSize:13,fontWeight:800}}>{shiftStartBusy?"Taking Over…":"Take Over Shift"}</button>
          </div>
        </div>
      </div>
      </>
    );
  }

  return(
    <><style>{themeCSS}</style>
    <div style={{display:"flex",flexDirection:"column",height:"100dvh",background:"var(--bg)",fontFamily:"var(--font),sans-serif",overflow:"hidden"}}>
    {devSupportMode&&(
      <div style={{flexShrink:0,zIndex:700,background:"#dc2626",color:"#fff",padding:"7px 16px",fontSize:12,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        <i className="ti ti-tool" style={{fontSize:14}} aria-hidden="true"/>
        DEV SUPPORT SESSION — {theme.storeName||"Store"} — auto-ends in 30 min
        <button onClick={endDevSession} disabled={endingSession} style={{marginLeft:14,padding:"3px 10px",background:"rgba(255,255,255,0.2)",border:"none",borderRadius:6,color:"#fff",cursor:endingSession?"default":"pointer",fontSize:11,fontWeight:700,opacity:endingSession?0.7:1}}>{endingSession?"Ending…":"End Session"}</button>
      </div>
    )}

    {/* ── TRIAL BANNER ── */}
    {license?.trialExpiresAt&&!isTrialExpired(license)&&(()=>{
      const daysLeft=getTrialDaysLeft(license);
      const urgent=daysLeft<=1;
      return(
        <div style={{flexShrink:0,background:urgent?"#dc2626":"#d97706",color:"#fff",padding:"7px 16px",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:8,flexWrap:"wrap",textAlign:"center"}}>
          <i className={`ti ${urgent?"ti-alert-triangle":"ti-clock"}`} style={{fontSize:14,flexShrink:0}} aria-hidden="true"/>
          <span>
            {urgent
              ?"⚠ Trial expires TODAY!"
              :`🎁 Free Trial — ${daysLeft} day${daysLeft!==1?"s":""} remaining.`
            }
          </span>
          <button
            onClick={()=>setTrialUnlocking(true)}
            style={{padding:"3px 10px",background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.5)",borderRadius:6,color:"#fff",cursor:"pointer",fontSize:11,fontWeight:800,whiteSpace:"nowrap",flexShrink:0}}
          >
            Upgrade Now →
          </button>
        </div>
      );
    })()}
    {/* ── BACK ONLINE BANNER ── */}
    {justCameOnline&&(
      <div style={{flexShrink:0,background:"#16a34a",color:"#fff",padding:"7px 16px",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:8,flexWrap:"wrap",textAlign:"center",animation:"_slideDown 0.25s ease"}}>
        <i className="ti ti-wifi" style={{fontSize:14,flexShrink:0}} aria-hidden="true"/>
        <span>✅ Back online — syncing your data.</span>
        <button
          onClick={()=>{
            doPush();
            clearTimeout(backOnlineTimer.current);
            setJustCameOnline(false);
          }}
          onMouseDown={e=>{e.currentTarget.style.transform="scale(0.94)";}}
          onMouseUp={e=>{e.currentTarget.style.transform="scale(1)";}}
          onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.background="rgba(255,255,255,0.2)";}}
          onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.32)";}}
          style={{padding:"3px 10px",background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.5)",borderRadius:6,color:"#fff",cursor:"pointer",fontSize:11,fontWeight:800,whiteSpace:"nowrap",flexShrink:0,display:"flex",alignItems:"center",gap:5,transition:"transform 0.12s ease, background 0.15s ease"}}
        >
          <i className="ti ti-cloud-upload" style={{fontSize:12}} aria-hidden="true"/> Sync Now
        </button>
      </div>
    )}
    <div style={{display:"flex",flexDirection:isMobile?"column":"row",flex:1,overflow:"hidden",minHeight:0}}>
      {!isMobile&&(
        <aside style={{width:sidebarW,background:"var(--sidebar)",display:"flex",flexDirection:"column",alignItems:"center",paddingTop:12,gap:2,flexShrink:0}}>
          <div style={{width:42,height:42,borderRadius:11,background:"var(--primary)",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12,flexShrink:0,overflow:"hidden"}}>
            {theme.logoUrl?<img src={theme.logoUrl} alt="logo" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{e.target.style.display="none";}}/>:<span style={{color:"#fff",fontWeight:800,fontSize:15}}>{(theme.logoText||"P").slice(0,2).toUpperCase()}</span>}
          </div>
          {NAV.map(n=>(
            <button key={n.id} onClick={()=>setView(n.id)} title={n.label} style={{width:sidebarW-10,height:52,border:"none",borderRadius:10,cursor:"pointer",background:view===n.id?"var(--primary)":"transparent",color:view===n.id?"#fff":"#6b7db3",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,transition:"background 0.18s ease, color 0.18s ease"}}>
              <i className={`ti ${n.icon}`} style={{fontSize:20}} aria-hidden="true"/>
              {bp==="desktop"&&<span style={{fontSize:9,fontWeight:600}}>{n.label}</span>}
            </button>
          ))}
          {isProgrammer&&<button onClick={()=>setView("devtools")} title="Dev Tools" style={{width:sidebarW-10,height:52,border:"none",borderRadius:10,cursor:"pointer",background:view==="devtools"?"#dc2626":"transparent",color:view==="devtools"?"#fff":"#ef4444",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3}}><i className="ti ti-tools" style={{fontSize:20}} aria-hidden="true"/>{bp==="desktop"&&<span style={{fontSize:9,fontWeight:600}}>Dev</span>}</button>}
          <div style={{flex:1}}/>
          <div style={{marginBottom:12,display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
            <button onClick={toggleFullscreen} title={isFullscreen?"Exit Fullscreen":"Enter Fullscreen"} style={{background:"none",border:"none",cursor:"pointer",color:"#6b7db3",fontSize:18,padding:4}}><i className={`ti ${isFullscreen?"ti-minimize":"ti-maximize"}`} aria-hidden="true"/></button>
            <SyncDot status={syncStatus}/>
            <div title={`${session.name} (${currentRole?.name})`} style={{width:34,height:34,borderRadius:"50%",background:isProgrammer?"#dc2626":"var(--primary)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:12,fontWeight:800}}>{session.name.slice(0,2).toUpperCase()}</div>
            <button onClick={logout} title="Logout" style={{background:"none",border:"none",cursor:"pointer",color:"#6b7db3",fontSize:20,padding:4}}><i className="ti ti-logout" aria-hidden="true"/></button>
          </div>
        </aside>
      )}
      <main style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0,animation:"_fadeIn 0.15s ease"}}>
        {view==="dashboard" &&can("sales_all")   &&<DashboardView orders={orders} products={products} shifts={shifts} activeShifts={activeShifts} theme={theme} primary={theme?.primary} orderSettings={orderSettings} invoices={invoices} purchaseOrders={purchaseOrders} enableInvoice={enableInvoice} enablePO={enablePO} logs={logs}/>}
        {view==="pos"       &&can("pos")           &&<POSView products={products} setProducts={setProducts} orders={orders} setOrders={setOrders} session={session} theme={theme} notify={notify} bp={bp} activeShift={activeShift} syncShiftEntry={syncShiftEntry} shifts={shifts} setShifts={setShifts} orderSettings={orderSettings} log={log} isOwnerOrAdmin={isOwnerOrAdmin} onSync={triggerSync} onSyncImmediate={doPush} onPullFresh={doPull} uiSettings={uiSettings} deviceSettings={deviceSettings} businessDetails={businessDetails} kitchenModuleEnabled={kitchenModuleEnabled} openBillsModuleEnabled={openBillsModuleEnabled} goToSettingsTab={goToSettingsTab} enableLoyalty={enableLoyalty} customers={customers} setCustomers={setCustomers} syncCustomerEntry={syncCustomerEntry} loyaltyRewards={loyaltyRewards} onLogout={forceLogout} onShiftEnded={setPostShiftReport}/>}
        {view==="orders"    &&can("orders_view")   &&<OrdersView orders={orders} setOrders={setOrders} can={can} notify={notify} log={log} onSync={triggerSync} products={products} setProducts={setProducts} activeShift={activeShift} isOwnerOrAdmin={isOwnerOrAdmin} theme={theme} orderSettings={orderSettings} businessDetails={businessDetails} kitchenModuleEnabled={kitchenModuleEnabled} storeEmail={license?.email||""} storeName={theme?.storeName||"My Store"} customers={customers} setCustomers={setCustomers} syncCustomerEntry={syncCustomerEntry} session={session}/>}
        {view==="inventory" &&can("inventory_view")&&<InventoryView products={products} setProducts={setProducts} can={can} notify={notify} categories={categories} setCategories={setCategories} skuSettings={skuSettings} setSku={setSku} isProgrammer={isProgrammer} log={log} session={session} onSync={triggerSync} logs={logs} orderSettings={orderSettings} orders={orders} purchaseOrders={purchaseOrders} invoices={invoices} countSessions={countSessions} setCountSessions={setCountSessions}/>}
        {view==="po"        &&enablePO&&can("purchase_orders")&&<PurchaseOrderView suppliers={suppliers} setSuppliers={setSuppliers} purchaseOrders={purchaseOrders} setPOs={setPOs} products={products} setProducts={setProducts} businessDetails={businessDetails} notify={notify} session={session} log={log} onSync={triggerSync} roles={roles}/>}
        {view==="invoice"   &&enableInvoice&&can("invoices")  &&<InvoiceView customers={customers} setCustomers={setCustomers} syncCustomerEntry={syncCustomerEntry} invoices={invoices} setInvoices={setInvoices} products={products} setProducts={setProducts} orders={orders} setOrders={setOrders} businessDetails={businessDetails} notify={notify} session={session} log={log} orderSettings={orderSettings} onSync={triggerSync}/>}
        {view==="loyalty"   &&enableLoyalty&&can("loyalty")   &&<LoyaltyView customers={customers} setCustomers={setCustomers} syncCustomerEntry={syncCustomerEntry} loyaltyRewards={loyaltyRewards} setLoyaltyRewards={setLoyaltyRewards} syncRewardEntry={syncRewardEntry} orders={orders} orderSettings={orderSettings} notify={notify} session={session} log={log} onSync={triggerSync} logs={logs} isProgrammer={isProgrammer}/>}
        {view==="bookings"  &&enableBookings&&can("bookings") &&<BookingsView bookings={bookings} setBookings={setBookings} syncBookingEntry={syncBookingEntry} bookingResources={bookingResources} setBookingResources={setBookingResources} bookingServices={bookingServices} setBookingServices={setBookingServices} bookingPageContent={bookingPageContent} setBookingPageContent={setBookingPageContent} bookingPageSettings={bookingPageSettings} setBookingPageSettings={setBookingPageSettings} businessDetails={businessDetails} orderSettings={orderSettings} customers={customers} setCustomers={setCustomers} syncCustomerEntry={syncCustomerEntry} notify={notify} session={session} log={log} onSync={triggerSync} isOwnerOrAdmin={isOwnerOrAdmin}/>}
        {view==="reports"   &&can("sales_today")   &&<ReportsView orders={orders} products={products} can={can} shifts={shifts} setShifts={setShifts} logs={logs} log={log} onSync={doPush} storeEmail={license?.email||""} storeName={theme?.storeName||"My Store"} session={session} activeShift={activeShift} isOwnerOrAdmin={isOwnerOrAdmin} isProgrammer={isProgrammer} orderSettings={orderSettings} storeExpenses={storeExpenses} setStoreExpenses={setStoreExpenses}/>}
        {view==="users"     &&can("manage_users")  &&<UsersView accounts={accounts} setAccounts={setAccounts} roles={roles} setRoles={setRoles} notify={notify} isProgrammer={isProgrammer} isOwnerOrAdmin={isOwnerOrAdmin} allAccountsForProgrammer={allAccountsForProgrammer} onSync={triggerSync} enablePO={enablePO} enableInvoice={enableInvoice} enableLoyalty={enableLoyalty} enableBookings={enableBookings} openBillsModuleEnabled={openBillsModuleEnabled}/>}
        {view==="settings"  &&canAccessSettings      &&<SettingsView theme={theme} setTheme={setTheme} loginSettings={loginSettings} saveLoginSettings={saveLoginSettings} skuSettings={skuSettings} setSku={setSku} orderSettings={orderSettings} setOrderSettings={setOrderSettings} notify={notify} isProgrammer={isProgrammer} businessDetails={businessDetails} setBusinessDetails={setBusinessDetails} onSync={triggerSync} enablePO={enablePO} enableInvoice={enableInvoice} enableLoyalty={enableLoyalty} uiSettings={uiSettings} setUiSettings={setUiSettings} deviceSettings={deviceSettings} setDeviceSettings={setDeviceSettings} kitchenModuleEnabled={kitchenModuleEnabled} openBillsModuleEnabled={openBillsModuleEnabled} pendingTab={pendingSettingsTab} onPendingTabConsumed={()=>setPendingSettingsTab(null)} restricted={!can("settings")}/>}
        {view==="devtools"  &&isProgrammer         &&<DevToolsView products={products} orders={orders} setOrders={setOrders} accounts={accounts} shifts={shifts} notify={notify} license={license} syncStatus={syncStatus} onForceSync={doSync} logs={logs} setLogs={setLogs} enablePO={enablePO} setEnablePO={setEnablePO} enableInvoice={enableInvoice} setEnableInvoice={setEnableInvoice} enableLoyalty={enableLoyalty} setEnableLoyalty={setEnableLoyalty} enableBookings={enableBookings} setEnableBookings={setEnableBookings} enableOpenBills={openBillsModuleEnabled} setEnableOpenBills={setOpenBillsModuleEnabled} kitchenModuleEnabled={kitchenModuleEnabled} setKitchenModuleEnabled={setKitchenModuleEnabled} onSync={triggerSync} onSyncImmediate={doPush}/>}
      </main>
      {isMobile&&(
        <nav style={{height:60,background:"var(--sidebar)",display:"flex",alignItems:"stretch",flexShrink:0,overflowX:"auto",overflowY:"hidden"}}>
          {NAV.map(n=>(<button key={n.id} onClick={()=>setView(n.id)} style={{minWidth:60,flex:"0 0 auto",border:"none",background:view===n.id?"var(--primary)":"transparent",color:view===n.id?"#fff":"#6b7db3",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,cursor:"pointer",padding:"0 4px",transition:"background 0.18s ease, color 0.18s ease"}}><i className={`ti ${n.icon}`} style={{fontSize:20}} aria-hidden="true"/><span style={{fontSize:9,fontWeight:600,whiteSpace:"nowrap"}}>{n.label}</span></button>))}
          <button onClick={logout} style={{minWidth:60,flex:"0 0 auto",border:"none",background:"transparent",color:"#6b7db3",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,cursor:"pointer",padding:"0 4px"}}><i className="ti ti-logout" style={{fontSize:20}} aria-hidden="true"/><span style={{fontSize:9,fontWeight:600}}>Logout</span></button>
        </nav>
      )}
    </div>
    </div>
    {screensaverActive&&<ScreensaverOverlay onDismiss={()=>{lastActivityRef.current=Date.now();setScreensaverActive(false);justDismissedScreensaverRef.current=true;setTimeout(()=>{justDismissedScreensaverRef.current=false;},350);}} session={session} activeShift={activeShift} orders={orders} theme={theme}/>}
    {toast&&(<div style={{position:"fixed",bottom:isMobile?72:24,left:"50%",transform:"translateX(-50%)",background:toast.type==="error"?"#fef2f2":toast.type==="warn"?"#fffbeb":"#f0fdf4",color:toast.type==="error"?"#991b1b":toast.type==="warn"?"#92400e":"#166534",border:`1px solid ${toast.type==="error"?"#fecaca":toast.type==="warn"?"#fde68a":"#bbf7d0"}`,borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:600,zIndex:9999,whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:8,boxShadow:"0 4px 12px rgba(0,0,0,0.1)",animation:"_toastIn 0.22s ease"}}><i className={`ti ${toast.type==="error"?"ti-alert-circle":toast.type==="warn"?"ti-alert-triangle":"ti-check"}`} style={{fontSize:16}} aria-hidden="true"/>{toast.msg}</div>)}

    {/* Logout warning — shift still active */}
    {logoutWarning&&(
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:600,padding:16}}>
        <div style={{background:"#fff",borderRadius:14,padding:24,width:"100%",maxWidth:360,textAlign:"center"}}>
          <div style={{width:52,height:52,borderRadius:"50%",background:"#fef3c7",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}>
            <i className="ti ti-alert-triangle" style={{fontSize:26,color:"#d97706"}} aria-hidden="true"/>
          </div>
          <div style={{fontWeight:800,fontSize:16,marginBottom:6}}>End Your Shift First</div>
          <div style={{fontSize:13,color:"#6b7280",marginBottom:20}}>You must end your current shift before logging out. This ensures your sales and cash are properly recorded.</div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setLogoutWarning(false)} style={{flex:1,padding:"10px 0",border:"1px solid #e5e7eb",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700}}>Cancel</button>
            <button onClick={()=>{setLogoutWarning(false);setView("pos");notify("Please end your shift first","warn");}} style={{flex:2,padding:"10px 0",background:"#d97706",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:800}}>Go to POS → End Shift</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}


// ════════════════════════════════════════════════════════
// SHIFT START INLINE — used in the shift gate screen
// ════════════════════════════════════════════════════════
function ShiftStartInline({session, onStart, busy=false}){
  const [openCash,setOpenCash] = useState("");
  return(
    <div>
      <div style={{display:"flex",gap:8,alignItems:"center",marginTop:4}}>
        <span style={{fontSize:13,color:"#374151",fontWeight:600}}>₱</span>
        <input autoComplete="off"
          type="number"
          value={openCash}
          onChange={e=>setOpenCash(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&!busy&&onStart(parseFloat(openCash)||0)}
          placeholder="0.00"
          disabled={busy}
          style={{flex:1,padding:"10px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:16,fontWeight:700,background:busy?"#f3f4f6":"#fff",outline:"none"}}
          autoFocus
        />
      </div>
      <button
        onClick={()=>!busy&&onStart(parseFloat(openCash)||0)}
        disabled={busy}
        style={{width:"100%",marginTop:10,padding:"11px 0",background:busy?"#9ca3af":"#16a34a",color:"#fff",border:"none",borderRadius:8,fontSize:14,fontWeight:800,cursor:busy?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:7}}
      >
        {busy ? <span style={{width:16,height:16,border:"2px solid rgba(255,255,255,0.4)",borderTop:"2px solid #fff",borderRadius:"50%",display:"inline-block",animation:"_njspin 0.8s linear infinite"}}/> : <i className="ti ti-player-play" aria-hidden="true"/>} {busy?"Starting…":"Start Shift"}
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// CRASH RECOVERY MODAL — shown after blackout/crash
// ════════════════════════════════════════════════════════
function CrashRecoveryModal({shift, shiftOrders, cashSales, estCloseCash, onClose}){
  const [closeCash,setCloseCash] = useState(String(Math.round(estCloseCash*100)/100));
  const fmt = (n) => `₱${Number(n||0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:700,padding:16}}>
      <div style={{background:"#fff",borderRadius:16,padding:26,width:"100%",maxWidth:420}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <div style={{width:44,height:44,borderRadius:"50%",background:"#fef3c7",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <i className="ti ti-alert-triangle" style={{fontSize:22,color:"#d97706"}} aria-hidden="true"/>
          </div>
          <div>
            <div style={{fontWeight:800,fontSize:15}}>Unfinished Shift Detected</div>
            <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>The app was closed during an active shift. Please close it now.</div>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
          {[
            {l:"Cashier",       v:shift?.cashier},
            {l:"Started",       v:shift?.startTime},
            {l:"Opening Cash",  v:fmt(shift?.openCash)},
            {l:"Orders Made",   v:`${shiftOrders?.length||0} orders`},
            {l:"Cash Sales",    v:fmt(cashSales)},
            {l:"Est. Closing",  v:fmt(estCloseCash)},
          ].map(r=>(
            <div key={r.l} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"5px 10px",background:"#f9fafb",borderRadius:6}}>
              <span style={{color:"#6b7280"}}>{r.l}</span>
              <span style={{fontWeight:700}}>{r.v}</span>
            </div>
          ))}
        </div>
        <div style={{marginBottom:14}}>
          <label style={{fontSize:11,fontWeight:800,color:"#6b7280",textTransform:"uppercase",letterSpacing:0.5,display:"block",marginBottom:5}}>
            Actual Cash in Drawer (₱) <span style={{fontSize:10,color:"#9ca3af",textTransform:"none"}}>— adjust if needed</span>
          </label>
          <input autoComplete="off"
            type="number"
            value={closeCash}
            onChange={e=>setCloseCash(e.target.value)}
            style={{width:"100%",padding:"10px 12px",border:"1px solid #e5e7eb",borderRadius:8,fontSize:18,fontWeight:700,background:"#f9fafb",outline:"none",boxSizing:"border-box"}}
          />
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>onClose(null)} style={{flex:1,padding:"10px 0",border:"1px solid #e5e7eb",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700}}>Dismiss</button>
          <button onClick={()=>{
            const actual = parseFloat(closeCash)||0;
            const expected = (parseFloat(shift?.openCash)||0)+cashSales;
            onClose({
              totalSales:shiftOrders?.reduce((s,o)=>s+o.total,0)||0,
              cashSales, totalExpenses:0, expenses:[],
              expectedCash:expected, actualCash:actual,
              overShort:actual-expected, closeCash:actual,
              shiftOrders:shiftOrders?.length||0,
            });
          }} style={{flex:2,padding:"10px 0",background:"#d97706",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:800}}>
            <i className="ti ti-player-stop" style={{marginRight:6}} aria-hidden="true"/>Close Shift
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// LOGIN — ROLE DROPDOWN → USERNAME → PASSWORD
// ════════════════════════════════════════════════════════
function LoginScreen({accounts,roles,onLogin,theme,activeShifts=[],orders,syncShiftEntry,shifts,setShifts,onSync,setAccounts,onSwitchStore,loginSettings={}}){
  // The shift open on THIS device specifically — same device-scoped
  // lookup the rest of the app uses. There's no session yet at the
  // login screen, so this can't be derived from "my own shift"; it's
  // purely "what's the state of the register I'm standing at."
  const deviceShift = activeShifts.find(s=>s.deviceId===DEVICE_ID) || null;
  const [selRoleId,setSelRoleId] = useState("");
  const [username,setUsername]   = useState("");
  const [password,setPassword]   = useState("");
  const [showPw,setShowPw]       = useState(false);
  const [error,setError]         = useState("");
  const [loading,setLoading]     = useState(false);
  // Developer access modal
  const [devModal,setDevModal]   = useState(false);
  const [devPw,setDevPw]         = useState("");
  const [devErr,setDevErr]       = useState("");
  const [storeSwitcherOpen,setStoreSwitcherOpen] = useState(false);
  const [ownerEndModal,setOwnerEndModal]=useState(false);
  const [ownerPw,setOwnerPw]=useState("");
  const [ownerPwErr,setOwnerPwErr]=useState("");
  const [ownerPwBusy,setOwnerPwBusy]=useState(false);
  // Device-lock: an account restricted to specific devices, caught trying
  // to log in on one it's not permitted on yet. Rather than a hard dead
  // end, this lets an owner/manager authenticate right here to grant this
  // device, then the original login continues automatically.
  const [deviceLockBlock,setDeviceLockBlock]=useState(null); // the account whose login is on hold
  const [grantRoleId,setGrantRoleId]=useState("");
  const [grantUsername,setGrantUsername]=useState("");
  const [grantPassword,setGrantPassword]=useState("");
  const [grantError,setGrantError]=useState("");
  const [grantBusy,setGrantBusy]=useState(false);
  const rBg = parseInt(theme.borderRadius)||10;
  const ls = loginSettings; // shorthand
  const loginCardText = ls.loginCardTextColor||"#111";
  const loginInputStyle = ls.loginInputBg ? {background:ls.loginInputBg} : {};

  const visibleRoles = roles.filter(r=>r.id!=="role_programmer");
  const selectedRole = roles.find(r=>r.id===selRoleId);

  const ROLE_C={role_owner:"#dbeafe",role_manager:"#fef3c7",role_staff:"#f0fdf4"};
  const ROLE_T={role_owner:"#1e40af",role_manager:"#92400e",role_staff:"#166534"};

  const login = async () => {
    if(!selRoleId){setError("Please select your role");return;}
    if(!username.trim()){setError("Please enter your username");return;}
    if(!password){setError("Please enter your password");return;}
    setLoading(true);
    // Check devadmin first (not stored in regular accounts)
    if(username.trim().toLowerCase() === "devadmin") {
      const ok = await bcrypt.compare(password, DEVADMIN_PASSWORD_HASH);
      if(ok){ onLogin({...PROGRAMMER}); return; }
      else{ setError("Incorrect username or password."); setLoading(false); return; }
    }
    // Snapshot accounts at this moment — sync may update state mid-login
    const currentAccounts = DB.get("accounts", []);
    const acc = currentAccounts.find(a=>
      a.active &&
      a.roleId === selRoleId &&
      a.username.toLowerCase() === username.trim().toLowerCase()
    );
    if(!acc){ setError("Incorrect username or password."); setLoading(false); return; }
    // Capture password now before any async operation
    const storedPassword = acc.password || "";
    let pwOk = false;
    if(storedPassword.startsWith("$2")) {
      pwOk = await bcrypt.compare(password, storedPassword);
    } else {
      // Legacy plain-text comparison
      pwOk = storedPassword === password;
      if(pwOk) {
        // Upgrade hash in background — don't block login
        setTimeout(async () => {
          const newHash = await bcrypt.hash(password, 10);
          const upgraded = DB.get("accounts",[]).map(a2 => a2.id === acc.id ? {...a2, password: newHash} : a2);
          DB.set("accounts", upgraded);
        }, 100);
      }
    }
    if(!pwOk){ setError("Incorrect username or password."); setLoading(false); return; }
    // Device lock — an empty/missing permittedDevices list means
    // unrestricted (the default for every account unless an owner
    // explicitly opts one in). The owner role is always exempt — locking
    // out the one account that would need to grant access in the first
    // place doesn't make sense. This is independent of the shift/handoff
    // logic above: multiple staff CAN be permitted on the same device
    // (they'll still need a handoff between each other), and one staff
    // can be permitted on multiple devices.
    const permitted = acc.permittedDevices||[];
    if(permitted.length>0 && acc.roleId!=="role_owner" && !permitted.some(d=>d.deviceId===DEVICE_ID)){
      setDeviceLockBlock(acc);
      setLoading(false);
      return;
    }
    onLogin({...acc});
  };

  const doGrantAccess = async () => {
    if(!deviceLockBlock) return;
    if(!grantRoleId){setGrantError("Select your role");return;}
    if(!grantUsername.trim()){setGrantError("Enter your username");return;}
    if(!grantPassword){setGrantError("Enter your password");return;}
    setGrantBusy(true); setGrantError("");
    const currentAccounts = DB.get("accounts", []);
    const granter = currentAccounts.find(a=>
      a.active && a.roleId===grantRoleId && a.username.toLowerCase()===grantUsername.trim().toLowerCase()
    );
    if(!granter){ setGrantError("Incorrect username or password."); setGrantBusy(false); return; }
    const stored = granter.password||"";
    let pwOk=false;
    if(stored.startsWith("$2")) pwOk = await bcrypt.compare(grantPassword, stored);
    else pwOk = stored===grantPassword;
    if(!pwOk){ setGrantError("Incorrect username or password."); setGrantBusy(false); return; }
    const granterRole = roles.find(r=>r.id===granter.roleId);
    const canGrant = granter.roleId==="role_owner" || (granterRole?.permissions?.includes("manage_users") ?? false);
    if(!canGrant){ setGrantError("This account doesn't have permission to grant device access."); setGrantBusy(false); return; }
    const lic = getLicense();
    const deviceEntry = {deviceId:DEVICE_ID, deviceName:lic?.deviceName||"This Device"};
    const updatedAccounts = currentAccounts.map(a=>
      a.id===deviceLockBlock.id ? {...a, permittedDevices:[...(a.permittedDevices||[]).filter(d=>d.deviceId!==DEVICE_ID), deviceEntry]} : a
    );
    DB.set("accounts", updatedAccounts);
    if(setAccounts) setAccounts(updatedAccounts);
    if(onSync) onSync();
    setGrantBusy(false);
    const pendingAcc = deviceLockBlock;
    setDeviceLockBlock(null); setGrantRoleId(""); setGrantUsername(""); setGrantPassword(""); setGrantError("");
    onLogin({...pendingAcc}); // complete the original login that was on hold
  };

  const devLogin = async () => {
    const ok = await bcrypt.compare(devPw, DEV_PASSWORD_HASH);
    if(ok){ setDevModal(false); onLogin({...PROGRAMMER}); }
    else{ setDevErr("Incorrect developer password."); }
  };

  // ── active shift helpers ──
  const fmt2=(n)=>`₱${Number(n||0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const shiftDuration=deviceShift?(()=>{
    const mins=Math.floor((Date.now()-new Date(deviceShift.startTime).getTime())/60000);
    if(isNaN(mins)||mins<0) return null;
    if(mins<60) return `${mins}m`;
    const h=Math.floor(mins/60),m=mins%60;
    return m>0?`${h}h ${m}m`:`${h}h`;
  })():null;
  // Same getOrderPaymentEvents-based summary the normal end-shift flow
  // and the live shift card use — a preorder downpayment collected on
  // this (possibly stuck) shift still counts, even though the order
  // itself stays "preorder" until its balance is collected later.
  const ownerEndShiftSummary=deviceShift?getShiftPaymentSummary(orders||[], deviceShift.id):{totalSales:0,cashSales:0,payBreakdown:{},orderCount:0};
  const shiftCashSales=ownerEndShiftSummary.cashSales;
  const estClose=(parseFloat(deviceShift?.openCash)||0)+shiftCashSales;
  const doOwnerEndShift=async()=>{
    if(!ownerPw){setOwnerPwErr("Enter owner password");return;}
    setOwnerPwBusy(true);setOwnerPwErr("");
    const ownerAccs=(accounts||[]).filter(a=>a.active&&(a.roleId==="role_owner"||a.roleId==="role_manager"));
    let matched=false;
    for(const acc of ownerAccs){
      const stored=acc.password||"";
      if(stored.startsWith("$2")){const ok=await bcrypt.compare(ownerPw,stored);if(ok){matched=true;break;}}
      else if(stored===ownerPw){matched=true;break;}
    }
    setOwnerPwBusy(false);
    if(!matched){setOwnerPwErr("Incorrect password");return;}
    // Debug — check what we have before building the record
    console.log("[doOwnerEndShift] deviceShift:", JSON.stringify(deviceShift));
    console.log("[doOwnerEndShift] orders count:", (orders||[]).length);
    console.log("[doOwnerEndShift] shiftOrders:", ownerEndShiftSummary.orderCount);
    console.log("[doOwnerEndShift] estClose:", estClose);
    // Build the partial shift record — payBreakdown/totalSales come
    // straight from the same event-based summary already computed above.
    const payBreakdown=ownerEndShiftSummary.payBreakdown;
    const ended={...deviceShift,endTime:new Date().toLocaleString("en-PH"),status:"partial",closedBySystem:true,closedReason:"ended_by_owner",totalSales:ownerEndShiftSummary.totalSales,cashSales:shiftCashSales,payBreakdown,totalExpenses:0,expenses:[],expectedCash:estClose,closeCash:estClose,overShort:0,shiftOrders:ownerEndShiftSummary.orderCount,editLocked:false,notes:""};
    // Pull current shifts from Supabase first — cloud-first merge prevents
    // stale localStorage on secondary devices from overwriting real data
    const lic=getLicense();
    let cloudShifts=DB.get("shifts",[]);
    if(lic?.storeId){
      try{
        const cloud=await pullFromCloud(lic.storeId);
        if(cloud?.shifts?.length) cloudShifts=cloud.shifts;
      }catch(e){ /* use local fallback if offline */ }
    }
    const mergedShifts=[ended,...cloudShifts.filter(s=>s.id!==ended.id)];
    DB.set("shifts",mergedShifts);
    if(setShifts) setShifts(mergedShifts);
    const result = syncShiftEntry ? await syncShiftEntry(current=>current.filter(s=>s.id!==deviceShift.id)) : true;
    if(!result){
      setOwnerPwErr("Couldn't reach the server — check your connection and try again.");
      return;
    }
    // Sync immediately so portal sees the ended shift
    if(onSync){ onSync(); setTimeout(()=>onSync(),3000); }
    setOwnerEndModal(false);setOwnerPw("");
  };
  return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:(theme.fontFamily||"sans-serif")+",sans-serif",padding:16,position:"relative",overflow:"hidden",background:ls.loginBg?"transparent":(theme.bgColor||"#f0f0f8")}}>
      {/* Background image + blur + overlay */}
      {ls.loginBg&&(<>
        <div style={{position:"absolute",inset:0,backgroundImage:`url(${ls.loginBg})`,backgroundSize:"cover",backgroundPosition:"center",filter:`blur(${ls.loginBgBlur||0}px)`,transform:"scale(1.05)",zIndex:0}}/>
        <div style={{position:"absolute",inset:0,background:ls.loginOverlayColor||"#000000",opacity:ls.loginOverlayOpacity??0.3,zIndex:1}}/>
      </>)}
      {deviceShift&&(
        <div style={{position:"fixed",top:0,left:0,right:0,zIndex:50}}>
          <div style={{background:"#fef3c7",borderBottom:"2px solid #fcd34d",padding:"10px 16px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <i className="ti ti-clock-exclamation" style={{fontSize:17,color:"#d97706",flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <span style={{fontSize:12,fontWeight:800,color:"#92400e"}}>{deviceShift.cashier} is still on shift — </span>
              <span style={{fontSize:12,color:"#92400e"}}>please log in to continue{shiftDuration?` (started ${shiftDuration} ago)`:""}</span>
            </div>
            <button onClick={()=>setOwnerEndModal(true)} style={{padding:"5px 12px",background:"#fff",color:"#92400e",border:"1px solid #d97706",borderRadius:7,cursor:"pointer",fontSize:11,fontWeight:700,flexShrink:0}}>Owner: End Shift Instead</button>
          </div>
        </div>
      )}
      {ownerEndModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:360}}>
            <div style={{fontWeight:800,fontSize:15,marginBottom:4}}>End Shift — Owner Verification</div>
            <div style={{fontSize:12,color:"#6b7280",marginBottom:14}}>Enter an Owner or Manager password to end <b>{deviceShift?.cashier}</b>'s shift and save it as a partial record.</div>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12,background:"#f9fafb",borderRadius:8,padding:"10px 12px"}}>
              {[{l:"Cashier",v:deviceShift?.cashier},{l:"Started",v:deviceShift?.startTime},{l:"Orders",v:`${ownerEndShiftSummary.orderCount}`},{l:"Est. Cash",v:fmt2(estClose)}].map(r=>(
                <div key={r.l} style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span style={{color:"#9ca3af"}}>{r.l}</span><span style={{fontWeight:700}}>{r.v}</span></div>
              ))}
            </div>
            <input autoComplete="off" type="password" value={ownerPw} onChange={e=>{setOwnerPw(e.target.value);setOwnerPwErr("");}} onKeyDown={e=>e.key==="Enter"&&doOwnerEndShift()} placeholder="Owner / Manager password" autoFocus
              style={{width:"100%",padding:"10px 12px",border:`1px solid ${ownerPwErr?"#fca5a5":"#e5e7eb"}`,borderRadius:8,fontSize:13,outline:"none",marginBottom:6,boxSizing:"border-box"}}/>
            {ownerPwErr&&<div style={{fontSize:12,color:"#dc2626",marginBottom:8}}>{ownerPwErr}</div>}
            <div style={{display:"flex",gap:8,marginTop:8}}>
              <button onClick={()=>{setOwnerEndModal(false);setOwnerPw("");setOwnerPwErr("");}} style={{flex:1,padding:"9px 0",border:"1px solid #e5e7eb",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700}}>Cancel</button>
              <button onClick={doOwnerEndShift} disabled={ownerPwBusy} style={{flex:2,padding:"9px 0",background:ownerPwBusy?"#fcd34d":"#d97706",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:800}}>{ownerPwBusy?"Verifying…":"End & Save as Partial"}</button>
            </div>
          </div>
        </div>
      )}
      {/* Inject login card label colors */}
      <style>{[
        ls.loginLabelColor||ls.loginCardTextColor?`.login-card label{color:${ls.loginLabelColor||ls.loginCardTextColor}!important;}`:"",
        ls.loginInputTransparent?`.login-card input,.login-card select{background:transparent!important;border-color:${ls.loginInputBorder||"#e5e7eb"}!important;}`:
          ls.loginInputBg?`.login-card input,.login-card select{background:${ls.loginInputBg}!important;border-color:${ls.loginInputBorder||"#e5e7eb"}!important;}`:"",
        ls.loginPlaceholderColor?`.login-card input::placeholder,.login-card select::placeholder{color:${ls.loginPlaceholderColor}!important;}`:"",
        ls.loginSelectOptionColor?`.login-card select option{color:${ls.loginSelectOptionColor}!important;background:#fff;}`:"",
        ls.loginInputTextColor?`.login-card input{color:${ls.loginInputTextColor}!important;}`:"",
      ].filter(Boolean).join("")}</style>
      <div className="login-card" style={{width:"100%",maxWidth:380,background:ls.loginCardBg?`rgba(${parseInt(ls.loginCardBg.slice(1,3),16)},${parseInt(ls.loginCardBg.slice(3,5),16)},${parseInt(ls.loginCardBg.slice(5,7),16)},${ls.loginCardOpacity??1})`:"rgba(255,255,255,"+(ls.loginCardOpacity??1)+")"
,borderRadius:20,padding:"34px 30px 28px",boxShadow:"0 8px 40px rgba(0,0,0,0.10)",marginTop:deviceShift?52:0,position:"relative",zIndex:2,backdropFilter:"blur(8px)"}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:26}}>
          <div style={{width:58,height:58,borderRadius:rBg+6+"px",background:theme.primary||"#2563EB",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 11px",overflow:"hidden"}}>
            {theme.logoUrl
              ?<img src={theme.logoUrl} alt="logo" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              :<span style={{color:"#fff",fontWeight:800,fontSize:20}}>{(theme.logoText||"P").slice(0,2).toUpperCase()}</span>
            }
          </div>
          <div style={{fontWeight:800,fontSize:19,color:ls.loginStoreNameColor||ls.loginCardTextColor||"#111"}}>{theme.storeName||"My Store"}</div>
          <div style={{fontSize:12,color:ls.loginSubtitleColor||ls.loginLabelColor||"#9ca3af",marginTop:3}}>Sign in to your account</div>
          {(()=>{
            const lic = getLicense();
            if(!lic?.deviceName||ls.loginHideDeviceInfo) return null;
            return(
              <div style={{fontSize:11,color:ls.loginDeviceInfoColor||"#9ca3af",marginTop:6,display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
                <i className="ti ti-device-desktop" style={{fontSize:12}} aria-hidden="true"/>
                {lic.deviceName}
                <span style={{fontFamily:"monospace",opacity:0.7}}>· {DEVICE_ID?.slice(-8)}</span>
              </div>
            );
          })()}
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:14,color:loginCardText}}>
          {/* Role dropdown */}
          <FRow label="Role">
            <div style={{position:"relative"}}>
              <select
                value={selRoleId}
                onChange={e=>{setSelRoleId(e.target.value);setUsername("");setPassword("");setError("");}}
                style={{...INP,paddingRight:36,appearance:"none",cursor:"pointer",color:selRoleId?(ls.loginSelectOptionColor||"#111"):(ls.loginPlaceholderColor||"#9ca3af")}}
              >
                <option value="">Select your role…</option>
                {visibleRoles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <i className="ti ti-chevron-down" style={{position:"absolute",right:11,top:"50%",transform:"translateY(-50%)",fontSize:15,color:"#9ca3af",pointerEvents:"none"}} aria-hidden="true"/>
            </div>
            {selectedRole&&(
              <span style={{display:"inline-block",marginTop:6,fontSize:11,fontWeight:700,padding:"2px 9px",borderRadius:20,background:ROLE_C[selRoleId]||"#f3f4f6",color:ROLE_T[selRoleId]||"#6b7280"}}>
                {selectedRole.name}
              </span>
            )}
          </FRow>

          {/* Username */}
          <FRow label="Username">
            <input
              value={username}
              onChange={e=>{setUsername(e.target.value);setError("");}}
              onKeyDown={e=>e.key==="Enter"&&login()}
              placeholder="Enter your username"
              style={INP}
              autoComplete="username"
            />
          </FRow>

          {/* Password */}
          <FRow label="Password">
            <div style={{position:"relative"}}>
              <input
                type={showPw?"text":"password"}
                value={password}
                onChange={e=>{setPassword(e.target.value);setError("");}}
                onKeyDown={e=>e.key==="Enter"&&login()}
                placeholder="Enter your password"
                style={{...INP,paddingRight:42}}
                autoComplete="current-password"
              />
              <button type="button" onClick={()=>setShowPw(s=>!s)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:ls.loginEyeIconColor||"#9ca3af",fontSize:17}}>
                <i className={`ti ${showPw?"ti-eye-off":"ti-eye"}`} aria-hidden="true"/>
              </button>
            </div>
          </FRow>
        </div>

        {error&&(
          <div style={{marginTop:12,padding:"9px 12px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,fontSize:13,color:"#991b1b",display:"flex",alignItems:"center",gap:7}}>
            <i className="ti ti-alert-circle" style={{fontSize:15,flexShrink:0}} aria-hidden="true"/>{error}
          </div>
        )}

        <button onClick={login} disabled={loading} style={{width:"100%",marginTop:18,padding:"13px 0",
          background:loading?"#93C5FD":(ls.loginBtnType==="outline"?"transparent":(ls.loginBtnBg||theme.primary||"#2563EB")),
          color:loading?"#fff":(ls.loginBtnTextColor||(ls.loginBtnType==="outline"?(ls.loginBtnBorderColor||theme.primary||"#2563EB"):"#fff")),
          border:ls.loginBtnType==="outline"?`2px solid ${ls.loginBtnBorderColor||theme.primary||"#2563EB"}`:"none",
          borderRadius:rBg+"px",fontSize:14,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          {loading
            ?<><i className="ti ti-loader-2" style={{fontSize:17}} aria-hidden="true"/>Signing in…</>
            :<><i className="ti ti-login" style={{fontSize:17}} aria-hidden="true"/>Sign In</>
          }
        </button>

        {/* ── Switch Store button ── */}
        {onSwitchStore&&(
          <button onClick={()=>setStoreSwitcherOpen(true)}
            style={{width:"100%",marginTop:10,padding:"10px 0",
              background:ls.loginSwitchBtnType==="solid"?(ls.loginSwitchBtnBg||"#6b7280"):"transparent",
              color:ls.loginSwitchBtnText||(ls.loginSwitchBtnType==="solid"?"#fff":"#6b7280"),
              border:ls.loginSwitchBtnType==="solid"?"none":`1px solid ${ls.loginSwitchBtnBorder||"#e5e7eb"}`,
              borderRadius:rBg+"px",fontSize:13,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            <i className="ti ti-building-store" style={{fontSize:15}} aria-hidden="true"/>
            Select another store
          </button>
        )}
      </div>

      {/* ── Store Switcher Modal ── */}
      {storeSwitcherOpen&&(()=>{
        const lic = getLicense();
        const stores = getRegisteredStores().filter(s=>s.email!==lic?.email);
        const PRIMARY = theme?.primary||"#2563EB";
        return(
          <div onClick={e=>{if(e.target===e.currentTarget)setStoreSwitcherOpen(false);}}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:360,boxShadow:"0 20px 60px rgba(0,0,0,0.25)",overflow:"hidden"}}>
              <div style={{padding:"16px 20px",borderBottom:"1px solid #f3f4f6",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:800,fontSize:15}}>Switch Store</div>
                  <div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>Currently: {lic?.storeName||lic?.email}</div>
                </div>
                <button onClick={()=>setStoreSwitcherOpen(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"#9ca3af",lineHeight:1}}>✕</button>
              </div>

              <div style={{maxHeight:300,overflowY:"auto",padding:"6px 0"}}>
                {stores.length===0?(
                  <div style={{padding:"28px 20px",textAlign:"center"}}>
                    <i className="ti ti-building-off" style={{fontSize:32,color:"#d1d5db",display:"block",marginBottom:10}}/>
                    <div style={{fontWeight:700,fontSize:14,color:"#374151",marginBottom:4}}>No other registered stores</div>
                    <div style={{fontSize:12,color:"#9ca3af",marginBottom:14}}>Go to the activation screen to add another store to this device.</div>
                    <button onClick={()=>{
                        setStoreSwitcherOpen(false);
                        onSwitchStore();
                      }}
                      style={{padding:"8px 20px",background:PRIMARY,color:"#fff",border:"none",borderRadius:8,fontWeight:700,fontSize:13,cursor:"pointer"}}>
                      + Add a store
                    </button>
                  </div>
                ):stores.map(s=>(
                  <button key={s.email} onClick={()=>{setStoreSwitcherOpen(false);onSwitchStore(s.email);}}
                    style={{width:"100%",padding:"13px 18px",background:"transparent",border:"none",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12,borderBottom:"0.5px solid #f3f4f6"}}>
                    <div style={{width:36,height:36,borderRadius:10,background:"#eff6ff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <i className="ti ti-building-store" style={{fontSize:18,color:PRIMARY}}/>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:14,color:"#0f172a",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.storeName}</div>
                      <div style={{fontSize:11,color:"#9ca3af",marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.email}</div>
                      <div style={{fontSize:10,color:"#d1d5db",marginTop:1}}>Last used: {s.lastUsed?new Date(s.lastUsed).toLocaleDateString("en-PH"):"-"}</div>
                    </div>
                    <i className="ti ti-chevron-right" style={{fontSize:14,color:"#d1d5db",flexShrink:0}}/>
                  </button>
                ))}
              </div>

              {stores.length>0&&(
                <div style={{padding:"10px 16px",borderTop:"1px solid #f3f4f6"}}>
                  <button onClick={()=>{setStoreSwitcherOpen(false);onSwitchStore();}} style={{width:"100%",padding:"8px 0",background:"transparent",border:"1px dashed #e5e7eb",borderRadius:8,color:"#6b7280",fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
                    <i className="ti ti-plus" style={{fontSize:13}}/> Add another store
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Developer access link — bottom right */}
      <button
        onClick={()=>{setDevModal(true);setDevPw("");setDevErr("");}}
        style={{position:"fixed",bottom:16,right:16,background:"none",border:"none",cursor:"pointer",fontSize:11,color:"rgba(0,0,0,0.25)",fontFamily:"sans-serif",padding:"4px 8px",borderRadius:4}}
      >
        Developer Access
      </button>

      {/* Developer modal */}
      {devModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:600,padding:16}}>
          <div style={{background:"#fff",borderRadius:14,padding:24,width:"100%",maxWidth:320}}>
            <div style={{fontWeight:800,fontSize:15,marginBottom:4,color:"#dc2626"}}>Developer Access</div>
            <div style={{fontSize:12,color:"#9ca3af",marginBottom:14}}>Enter the developer password</div>
            <div style={{position:"relative"}}>
              <input autoComplete="off" type="password" value={devPw} onChange={e=>{setDevPw(e.target.value);setDevErr("");}} onKeyDown={e=>e.key==="Enter"&&devLogin()} placeholder="Developer password" style={INP} autoFocus/>
            </div>
            {devErr&&<div style={{marginTop:8,fontSize:12,color:"#991b1b"}}>{devErr}</div>}
            <div style={{display:"flex",gap:8,marginTop:14}}>
              <button onClick={()=>setDevModal(false)} style={{flex:1,padding:"9px 0",border:"1px solid #e5e7eb",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700}}>Cancel</button>
              <button onClick={devLogin} style={{flex:2,padding:"9px 0",background:"#dc2626",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:800}}>Enter</button>
            </div>
          </div>
        </div>
      )}
      {deviceLockBlock&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:600,padding:16}}>
          <div style={{background:"#fff",borderRadius:14,padding:24,width:"100%",maxWidth:360}}>
            <div style={{width:52,height:52,borderRadius:"50%",background:"#fef3c7",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}>
              <i className="ti ti-device-mobile-off" style={{fontSize:24,color:"#d97706"}} aria-hidden="true"/>
            </div>
            <div style={{fontWeight:800,fontSize:15,marginBottom:6,textAlign:"center"}}>Device Not Permitted</div>
            <div style={{fontSize:12,color:"#6b7280",marginBottom:16,textAlign:"center",lineHeight:1.5}}>
              <b>{deviceLockBlock.name}</b>'s account can't log in on this device yet. An owner or manager can grant access below to continue.
            </div>
            <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",textTransform:"uppercase",letterSpacing:0.4,marginBottom:8}}>Owner / Manager Approval</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <select value={grantRoleId} onChange={e=>{setGrantRoleId(e.target.value);setGrantError("");}} style={INP}>
                <option value="">Select role…</option>
                {visibleRoles.filter(r=>r.id==="role_owner"||r.permissions?.includes("manage_users")).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <input autoComplete="off" value={grantUsername} onChange={e=>{setGrantUsername(e.target.value);setGrantError("");}} placeholder="Username" style={INP}/>
              <input autoComplete="off" type="password" value={grantPassword} onChange={e=>{setGrantPassword(e.target.value);setGrantError("");}} onKeyDown={e=>e.key==="Enter"&&doGrantAccess()} placeholder="Password" style={INP}/>
            </div>
            {grantError&&<div style={{marginTop:8,fontSize:12,color:"#991b1b"}}>{grantError}</div>}
            <div style={{display:"flex",gap:8,marginTop:16}}>
              <button onClick={()=>{setDeviceLockBlock(null);setGrantRoleId("");setGrantUsername("");setGrantPassword("");setGrantError("");}} style={{flex:1,padding:"10px 0",border:"1px solid #e5e7eb",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700}}>Cancel</button>
              <button onClick={doGrantAccess} disabled={grantBusy} style={{flex:2,padding:"10px 0",background:grantBusy?"#d1d5db":"#d97706",color:"#fff",border:"none",borderRadius:8,cursor:grantBusy?"default":"pointer",fontSize:13,fontWeight:800}}>{grantBusy?"Checking…":"Grant Access & Continue"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// SHIFT MODAL
// ════════════════════════════════════════════════════════
// ShiftModal — moved to src/views/POSView.jsx

// ════════════════════════════════════════════════════════
// POS VIEW
// ════════════════════════════════════════════════════════
// Bluetooth's own security model (not something any code change can work
// around) means a connection can't be silently restored after a page
// reload the way USB's can — every app update or accidental refresh can
// drop a Bluetooth-connected printer. The best available mitigation:
// make reconnecting a single, always-visible tap right where the
// cashier already is, instead of a trip through Settings. Attempting
// the reconnect from an actual button tap (rather than automatically on
// page load, which is what silently failed before) gives the browser a
// real user gesture to work with, which is the most likely reason the
// automatic attempt wasn't reliable.
// PrinterReconnectBanner — moved to src/views/POSView.jsx

// POSView — moved to src/views/POSView.jsx

// ════════════════════════════════════════════════════════
// ORDERS VIEW
// ════════════════════════════════════════════════════════
// ── VARIANT PICKER MODAL ──
// Shown when the POS grid is clicked for a product that has variants.
// The cashier picks one option per variant type; once every type has a
// selection AND that exact combination exists as a variant, the price
// and stock for that combo are shown and "Add to Cart" is enabled.
// ── CAMERA CAPTURE MODAL ──
// Lets the person take a product photo with whatever camera the current
// device has (phone/tablet rear camera, laptop webcam) instead of only
// picking a file. Uses getUserMedia + a canvas snapshot rather than the
// file input's `capture` attribute, since that attribute is mobile-only
// and silently does nothing on desktop — this works the same way
// everywhere a camera is available, and fails with a clear message
// where it isn't (e.g. no camera, or permission denied).
// CameraCaptureModal — moved to src/views/InventoryView.jsx

// ── CAMERA BARCODE SCANNER MODAL ──
// For tablets/devices with no physical scanner. Uses ZXing (a pure-JS
// decoder that reads frames off a canvas) rather than the browser's
// native BarcodeDetector API — that API isn't implemented in Safari/iOS
// at all, and this needs to work on iPads, not just Android/Chrome
// devices. Slightly more CPU cost than a native decoder, but it's the
// only approach that actually works everywhere a tablet camera might be.
// Hints bias the decoder toward the formats retail SKUs/barcodes
// actually use, and TRY_HARDER spends more effort per frame — both are
// the standard fixes when ZXing shows a clear, in-focus barcode on
// screen but still doesn't decode it. Built once at module scope since
// it's the same for every scan session.
// BARCODE_SCAN_HINTS — moved to src/views/POSView.jsx

// CameraBarcodeScannerModal — moved to src/views/POSView.jsx

// VariantPickerModal — moved to src/views/POSView.jsx

// Shown when the POS grid is clicked for a product sold by weight (e.g.
// meat, fish, rice priced per kilo). The cashier types the weighed
// amount and the price is calculated live as weight × price-per-unit —
// same modal shape as VariantPickerModal, but a free decimal input
// instead of preset option buttons. `editingItem`, if given, is the
// existing cart line being corrected (pre-fills its weight and updates
// that line in place instead of adding a new one).
// WeightEntryModal — moved to src/views/POSView.jsx

// ── DASHBOARD ── mirrors the client portal's Dashboard (same cards, same
// sections) so an owner using a second device purely to monitor the store
// gets the same at-a-glance view without needing the portal at all.
// Reads straight from local state — no fetch needed, this data's already
// live in the app.
// ── SHIFT SCREENSAVER ── idle-time overlay shown app-wide while a
// non-exempt user is on shift. Two columns: live clock, and a running
// total for the current shift — kept deliberately glanceable rather
// than a dense report, since this is meant to be seen from across the
// counter, not read closely. The clock ticking also means the screen
// is never fully static, which incidentally helps with tablet burn-in.
// ScreensaverOverlay — moved to src/views/DashboardView.jsx

// DashboardView — moved to src/views/DashboardView.jsx

// OrdersView — moved to src/views/OrdersView.jsx

// ════════════════════════════════════════════════════════
// INVENTORY VIEW
// ════════════════════════════════════════════════════════
// InventoryView — moved to src/views/InventoryView.jsx
// ════════════════════════════════════════════════════════
// REPORTS VIEW
// ════════════════════════════════════════════════════════
// ── SHIFTS TAB (standalone so useState works) ──
// ShiftsTab — moved to src/views/ReportsView.jsx



// ReportsView — moved to src/views/ReportsView.jsx
// UsersView — moved to src/views/UsersView.jsx

// ════════════════════════════════════════════════════════
// SETTINGS VIEW
// ════════════════════════════════════════════════════════
// SettingsView — moved to src/views/SettingsView.jsx

// Handles the "Connect Printer" flow for Settings → Printer. Connection
// state lives in the module-level `directPrinter` variable (see its
// declaration for why — printReceipt() needs to read it from anywhere,
// not just from whichever component happened to open the connection),
// so this component's job is just to drive that + reflect it visually.
// PrinterConnectPanel — moved to src/views/SettingsView.jsx

// Diagnostic tool for Settings → Scanner. Doesn't detect a connected
// scanner ahead of time (not possible — see the note above it) but
// confirms, after an actual scan, whether the keystroke pattern matched
// what the POS expects to treat as "this came from a scanner."
// ScannerTestTool — moved to src/views/SettingsView.jsx

// ════════════════════════════════════════════════════════
// DEV TOOLS VIEW
// ════════════════════════════════════════════════════════
// DevToolsView — moved to src/views/DevToolsView.jsx

// ProgCredentials — moved to src/views/DevToolsView.jsx

// ════════════════════════════════════════════════════════
// PURCHASE ORDER VIEW
// ════════════════════════════════════════════════════════
// PurchaseOrderView — moved to src/views/PurchaseOrderView.jsx

// POForm — moved to src/views/PurchaseOrderView.jsx

// GRNModal — moved to src/views/PurchaseOrderView.jsx

// Voucher codes avoid visually-confusable characters (0/O, 1/I/L) since
// these are meant to be read off a printout or a photo, sometimes by a
// customer relaying it verbally to a different cashier days later —
// legibility matters more here than keyspace size for a small business.
const VOUCHER_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const genVoucherCode = () => {
  let code = "";
  for(let i=0;i<7;i++) code += VOUCHER_CHARS[Math.floor(Math.random()*VOUCHER_CHARS.length)];
  return `LYT-${code}`;
};
// Computes what a voucher is actually worth against a given cart total —
// shared between the payment modal (preview) and processPayment (apply),
// so the two can never compute a different number for the same voucher.
// computeVoucherDiscount — moved to src/lib/posHelpers.js
// Same fixed/percent-with-cap shape as computeVoucherDiscount, just reading
// from the store-wide Loyalty settings instead of a specific redemption
// record — there's only ever one birthday discount configuration per store.
// computeBirthdayDiscount — moved to src/lib/posHelpers.js
// Month+day match only — a birthday recurs every year, so the year on
// the stored birthdate is irrelevant to whether today IS the birthday.
// isBirthdayToday — moved to src/lib/posHelpers.js

// ════════════════════════════════════════════════════════
// LOYALTY VIEW
// ════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════
// BOOKINGS — helpers
// ════════════════════════════════════════════════════════

function LoyaltyView({customers,setCustomers,syncCustomerEntry,loyaltyRewards,setLoyaltyRewards,syncRewardEntry,orders,orderSettings,notify,session,log,onSync,logs=[],isProgrammer}){
  const [tab,setTab]=useState("customers"); // customers | redeem
  const [search,setSearch]=useState("");
  const [custDetail,setCustDetail]=useState(null); // customer id being viewed
  const [custModal,setCustModal]=useState(null); // "new" | "edit" | null
  const [currentCust,setCurrentCust]=useState(null);
  const [rewardModal,setRewardModal]=useState(null); // "new" | "edit" | null
  const [currentReward,setCurrentReward]=useState(null);
  const [redeemPick,setRedeemPick]=useState(null); // reward being confirmed for the open customer
  const [voucherDisplay,setVoucherDisplay]=useState(null); // {redemption, customer} — just-generated, shown for print/photo

  const detailCust = custDetail ? customers.find(c=>c.id===custDetail) : null;

  const filteredCustomers = customers.filter(c=>
    !search.trim() || c.name?.toLowerCase().includes(search.toLowerCase()) || c.phone?.includes(search) || c.email?.toLowerCase().includes(search.toLowerCase())
  ).sort((a,b)=>(b.loyaltyPoints||0)-(a.loyaltyPoints||0));

  const custOrders = (cust) => orders.filter(o=>o.customerId===cust.id && o.status==="paid").sort((a,b)=>new Date(b.date)-new Date(a.date));
  const custSpend = (cust) => custOrders(cust).reduce((s,o)=>s+o.total,0);

  const newCustForm = () => ({id:"cust"+uid(), firstName:"", lastName:"", name:"", phone:"", email:"", birthday:"", loyaltyPoints:0, loyaltyJoinedAt:new Date().toISOString(), loyaltyRedemptions:[]});

  const saveCustomer = () => {
    if(!currentCust.firstName?.trim()){ notify("First name required","error"); return; }
    const toSave = {...currentCust, name:[currentCust.firstName?.trim(),currentCust.lastName?.trim()].filter(Boolean).join(" ")};
    if(custModal==="new") syncCustomerEntry(prev=>[...prev, toSave]);
    else syncCustomerEntry(prev=>prev.map(c=>c.id===toSave.id?toSave:c));
    log("LOYALTY", custModal==="new"?"customer_added":"customer_edited", `${custModal==="new"?"Added":"Updated"} loyalty customer: ${toSave.name}`);
    notify(custModal==="new"?"Customer added!":"Customer updated!");
    setCustModal(null);
  };

  const newRewardForm = () => ({id:"rwd"+uid(), name:"", type:"merchandise", pointsCost:100, active:true, stock:null, discountType:"fixed", discountValue:0, discountCap:0, image:""});

  const handleRewardImg = async(e)=>{
    const f=e.target.files[0]; if(!f) return;
    const compressed=await compressImage(f);
    const storeId=getLicense()?.storeId||"";
    const url=storeId?await supa.uploadImage(storeId,currentReward.id,compressed):null;
    setCurrentReward(r=>({...r,image:url||compressed}));
  };

  const saveReward = () => {
    if(!currentReward.name.trim()){ notify("Reward name required","error"); return; }
    if(!currentReward.pointsCost||currentReward.pointsCost<=0){ notify("Points cost must be greater than 0","error"); return; }
    if(rewardModal==="new") syncRewardEntry(prev=>[...prev, currentReward]);
    else syncRewardEntry(prev=>prev.map(r=>r.id===currentReward.id?currentReward:r));
    log("LOYALTY", rewardModal==="new"?"reward_added":"reward_edited", `${rewardModal==="new"?"Added":"Updated"} reward: ${currentReward.name} (${currentReward.pointsCost} pts, ${currentReward.type})`);
    notify(rewardModal==="new"?"Reward added!":"Reward updated!");
    setRewardModal(null);
  };

  const confirmRedeem = () => {
    if(!detailCust || !redeemPick) return;
    const reward = redeemPick;
    const balance = detailCust.loyaltyPoints||0;
    if(balance < reward.pointsCost){ notify("Not enough points","error"); return; }
    if(reward.type==="merchandise" && reward.stock!==null && reward.stock<=0){ notify("Out of stock","error"); return; }

    const redemption = {
      id:"rdm"+uid(), rewardId:reward.id, rewardName:reward.name, type:reward.type,
      pointsCost:reward.pointsCost, redeemedAt:new Date().toLocaleString("en-PH"), redeemedBy:session?.name||"",
      status: reward.type==="merchandise" ? "claimed" : "unused",
      ...(reward.type==="voucher" ? {
        voucherCode: genVoucherCode(),
        discountType: reward.discountType, discountValue: reward.discountValue, discountCap: reward.discountCap||0,
      } : {}),
    };

    syncCustomerEntry(prev=>prev.map(c=>c.id===detailCust.id
      // Math.max: this mutation replays against the CLOUD's copy during
      // reconcile, where the balance may already be lower than the local
      // snapshot the affordability check above ran on — never go negative.
      ? {...c, loyaltyPoints:Math.max(0,(c.loyaltyPoints||0)-reward.pointsCost), loyaltyRedemptions:[redemption,...(c.loyaltyRedemptions||[])]}
      : c
    ));
    if(reward.type==="merchandise" && reward.stock!==null){
      syncRewardEntry(prev=>prev.map(r=>r.id===reward.id?{...r,stock:Math.max(0,r.stock-1)}:r));
    }
    log("LOYALTY","redeem",`${detailCust.name} redeemed "${reward.name}" for ${reward.pointsCost} points${redemption.voucherCode?` — Code: ${redemption.voucherCode}`:""}`);
    notify(`Redeemed: ${reward.name}`);
    setRedeemPick(null);
    if(reward.type==="voucher") setVoucherDisplay({redemption, customer:detailCust});
  };

  const markVoucherUsed = (cust, redemptionId) => {
    syncCustomerEntry(prev=>prev.map(c=>c.id===cust.id
      ? {...c, loyaltyRedemptions:c.loyaltyRedemptions.map(r=>r.id===redemptionId?{...r,status:"used",usedAt:new Date().toLocaleString("en-PH")}:r)}
      : c
    ));
    log("LOYALTY","voucher_used_manual",`Voucher marked used manually for ${cust.name}`);
  };

  const printVoucher = (redemption, customer) => {
    const discountLabel = redemption.discountType==="fixed"
      ? `${fmt(redemption.discountValue)} OFF`
      : `${redemption.discountValue}% OFF${redemption.discountCap>0?` (max ${fmt(redemption.discountCap)})`:""}`;
    const html = `
      <div style="text-align:center;padding:30px 20px;border:3px dashed #2563EB;border-radius:12px;max-width:380px;margin:20px auto;font-family:Arial,sans-serif">
        <div style="font-size:11px;color:#6b7280;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Loyalty Reward Voucher</div>
        <div style="font-size:22px;font-weight:800;color:#111;margin-bottom:4px">${discountLabel}</div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:18px">${redemption.rewardName}</div>
        <div style="font-size:28px;font-weight:800;letter-spacing:4px;font-family:monospace;padding:14px;background:#f9fafb;border-radius:8px;margin-bottom:10px">${redemption.voucherCode}</div>
        <div style="font-size:11px;color:#9ca3af">Issued to ${customer.name} · ${redemption.redeemedAt}</div>
        <div style="font-size:10px;color:#d1d5db;margin-top:10px">Present this code at checkout to redeem</div>
      </div>`;
    printReport(html, `Voucher — ${redemption.voucherCode}`);
  };

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--bg)"}}>
      <div style={{padding:"14px 16px",background:"#fff",borderBottom:"0.5px solid rgba(0,0,0,0.08)",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:5}}>
          {[{k:"customers",l:"Customers"},{k:"redeem",l:"Redeem"},{k:"logs",l:"Logs"}].map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)} style={{padding:"6px 14px",borderRadius:8,border:"1px solid",cursor:"pointer",fontSize:13,fontWeight:700,borderColor:tab===t.k?"var(--primary)":"#e5e7eb",background:tab===t.k?"var(--primary)":"#fff",color:tab===t.k?"#fff":"#6b7280"}}>{t.l}</button>
          ))}
        </div>
        {tab==="customers"&&(
          <>
            <input autoComplete="off" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, phone, email…" style={{...INP,flex:1,minWidth:160,padding:"7px 12px"}}/>
            <button onClick={()=>{setCurrentCust(newCustForm());setCustModal("new");}} style={{padding:"7px 14px",background:"var(--primary)",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:5}}>
              <i className="ti ti-plus" aria-hidden="true"/> Add Customer
            </button>
          </>
        )}
        {tab==="redeem"&&(
          <button onClick={()=>{setCurrentReward(newRewardForm());setRewardModal("new");}} style={{marginLeft:"auto",padding:"7px 14px",background:"var(--primary)",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:5}}>
            <i className="ti ti-plus" aria-hidden="true"/> Add Reward
          </button>
        )}
      </div>

      <div style={{flex:1,overflow:"auto",padding:16}}>
        {tab==="customers"&&(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {filteredCustomers.length===0&&<div style={{textAlign:"center",padding:40,color:"#9ca3af",fontSize:13}}>No customers yet</div>}
            {filteredCustomers.map(c=>(
              <div key={c.id} onClick={()=>setCustDetail(c.id)} style={{background:"#fff",borderRadius:10,padding:"12px 16px",display:"flex",alignItems:"center",gap:12,cursor:"pointer",border:"0.5px solid rgba(0,0,0,0.07)"}}>
                <div style={{width:38,height:38,borderRadius:"50%",background:"var(--primary)18",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,color:"var(--primary)",flexShrink:0}}>{c.name?.[0]?.toUpperCase()||"?"}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:14,display:"flex",alignItems:"center",gap:6}}>{c.name}{isBirthdayToday(c.birthday)&&<span style={{fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:8,background:"#fef3c7",color:"#b45309"}}>🎂 TODAY</span>}</div>
                  <div style={{fontSize:11,color:"#9ca3af"}}>{c.phone||c.email||"No contact info"}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontWeight:800,fontSize:15,color:"var(--primary)"}}>{c.loyaltyPoints||0} pts</div>
                  <div style={{fontSize:11,color:"#9ca3af"}}>{fmt(custSpend(c))} total</div>
                </div>
                <i className="ti ti-chevron-right" style={{color:"#d1d5db"}} aria-hidden="true"/>
              </div>
            ))}
          </div>
        )}

        {tab==="redeem"&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:14}}>
            {loyaltyRewards.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:40,color:"#9ca3af",fontSize:13}}>No rewards in the catalog yet</div>}
            {loyaltyRewards.map(r=>(
              <div key={r.id} onClick={()=>{setCurrentReward(r);setRewardModal("edit");}} style={{background:"#fff",borderRadius:12,padding:16,border:"0.5px solid rgba(0,0,0,0.07)",cursor:"pointer",opacity:r.active?1:0.5}}>
                <div style={{width:"100%",aspectRatio:"1.6",borderRadius:8,marginBottom:10,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",background:r.type==="voucher"?"#eff6ff":"#f9fafb"}}>
                  {r.type==="voucher"
                    ? <i className="ti ti-ticket" style={{fontSize:34,color:"#1e40af"}} aria-hidden="true"/>
                    : r.image
                      ? <img src={r.image} alt={r.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                      : <i className="ti ti-gift" style={{fontSize:34,color:"#9ca3af"}} aria-hidden="true"/>}
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:8,background:r.type==="voucher"?"#eff6ff":"#f0fdf4",color:r.type==="voucher"?"#1e40af":"#166534"}}>{r.type==="voucher"?"Voucher":"Merch"}</span>
                  {!r.active&&<span style={{fontSize:10,fontWeight:700,color:"#9ca3af"}}>Inactive</span>}
                </div>
                <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>{r.name}</div>
                <div style={{fontSize:12,color:"#6b7280",marginBottom:8}}>
                  {r.type==="voucher"
                    ? (r.discountType==="fixed"?`${fmt(r.discountValue)} off`:`${r.discountValue}% off${r.discountCap>0?` (max ${fmt(r.discountCap)})`:""}`)
                    : (r.stock!==null?`${r.stock} in stock`:"Unlimited stock")}
                </div>
                <div style={{fontWeight:800,fontSize:16,color:"var(--primary)"}}>{r.pointsCost} pts</div>
              </div>
            ))}
          </div>
        )}

        {tab==="logs"&&(()=>{
          const loyaltyLogs = logs.filter(l=>l.type==="LOYALTY"&&(!l.viaDevSupport||isProgrammer)).sort((a,b)=>new Date(b.ts)-new Date(a.ts));
          const ACTION_LABEL = {
            points_earned:"Points Earned", voucher_applied:"Voucher Applied", redeem:"Redeemed",
            voucher_used_manual:"Voucher Marked Used", void_reversal:"Void Reversal",
            customer_added:"Customer Added", customer_edited:"Customer Edited",
            reward_added:"Reward Added", reward_edited:"Reward Edited",
          };
          const ACTION_COLOR = {
            points_earned:"#166534", voucher_applied:"#7c3aed", redeem:"#1e40af",
            voucher_used_manual:"#6b7280", void_reversal:"#dc2626",
            customer_added:"#166534", customer_edited:"#92400e",
            reward_added:"#166534", reward_edited:"#92400e",
          };
          return(
            <div style={{display:"flex",flexDirection:"column",gap:0,background:"#fff",borderRadius:10,border:"0.5px solid rgba(0,0,0,0.07)",overflow:"hidden"}}>
              {loyaltyLogs.length===0&&<div style={{textAlign:"center",padding:40,color:"#9ca3af",fontSize:13}}>No loyalty activity yet</div>}
              {loyaltyLogs.map(l=>(
                <div key={l.id} style={{padding:"10px 16px",borderBottom:"1px solid #f3f4f6",display:"flex",gap:12,alignItems:"flex-start"}}>
                  <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:8,background:"#f9fafb",color:ACTION_COLOR[l.action]||"#6b7280",flexShrink:0,whiteSpace:"nowrap",marginTop:1}}>{ACTION_LABEL[l.action]||l.action}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12.5,color:"#374151"}}>{l.detail}</div>
                    <div style={{fontSize:10,color:"#9ca3af",marginTop:2}}>{l.actor||"System"} · {l.ts?new Date(l.ts).toLocaleString("en-PH"):""}</div>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* ── CUSTOMER DETAIL ── */}
      {detailCust&&(
        <Overlay onClose={()=>setCustDetail(null)}>
          <ModalBox title={detailCust.name} onClose={()=>setCustDetail(null)} maxWidth={480}>
            {detailCust.birthday&&(
              <div style={{fontSize:12,color:isBirthdayToday(detailCust.birthday)?"#b45309":"#9ca3af",fontWeight:isBirthdayToday(detailCust.birthday)?700:400,marginBottom:12}}>
                {isBirthdayToday(detailCust.birthday)?"🎂 Birthday today! ":"🎂 "}
                {new Date(detailCust.birthday+"T00:00:00").toLocaleDateString("en-PH",{month:"long",day:"numeric"})}
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              <div style={{background:"#f5f3ff",borderRadius:10,padding:"10px 14px"}}>
                <div style={{fontSize:10,color:"#9ca3af",fontWeight:700,textTransform:"uppercase"}}>Points Balance</div>
                <div style={{fontSize:22,fontWeight:800,color:"var(--primary)"}}>{detailCust.loyaltyPoints||0}</div>
              </div>
              <div style={{background:"#f9fafb",borderRadius:10,padding:"10px 14px"}}>
                <div style={{fontSize:10,color:"#9ca3af",fontWeight:700,textTransform:"uppercase"}}>Total Spent</div>
                <div style={{fontSize:22,fontWeight:800,color:"#374151"}}>{fmt(custSpend(detailCust))}</div>
              </div>
            </div>

            <div style={{display:"flex",gap:8,marginBottom:16}}>
              <button onClick={()=>{
                // Existing customers created before first/last name split
                // only have `.name` — best-effort fallback so editing one
                // doesn't just show blank name fields.
                const needsMigration = !detailCust.firstName && detailCust.name;
                setCurrentCust(needsMigration ? {...detailCust, firstName:detailCust.name, lastName:""} : detailCust);
                setCustModal("edit");
              }} style={{flex:1,padding:"8px 0",border:"1px solid #e5e7eb",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700}}>Edit Info</button>
              <button onClick={()=>setRedeemPick("__catalog__")} style={{flex:2,padding:"8px 0",background:"var(--primary)",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700}}>Redeem a Reward</button>
            </div>

            <div style={{fontWeight:800,fontSize:12,marginBottom:8,color:"#6b7280",textTransform:"uppercase",letterSpacing:0.4}}>Purchase History</div>
            <div style={{maxHeight:140,overflow:"auto",marginBottom:16}}>
              {custOrders(detailCust).length===0&&<div style={{fontSize:12,color:"#9ca3af",padding:"8px 0"}}>No purchases yet</div>}
              {custOrders(detailCust).slice(0,10).map(o=>(
                <div key={o.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f3f4f6",fontSize:12}}>
                  <span style={{color:"#6b7280"}}>{o.date}</span>
                  <span style={{fontWeight:700}}>{fmt(o.total)}</span>
                  <span style={{color:"#16a34a"}}>+{o.pointsEarned||0} pts</span>
                </div>
              ))}
            </div>

            <div style={{fontWeight:800,fontSize:12,marginBottom:8,color:"#6b7280",textTransform:"uppercase",letterSpacing:0.4}}>Redemption History</div>
            <div style={{maxHeight:180,overflow:"auto"}}>
              {(detailCust.loyaltyRedemptions||[]).length===0&&<div style={{fontSize:12,color:"#9ca3af",padding:"8px 0"}}>No redemptions yet</div>}
              {(detailCust.loyaltyRedemptions||[]).map(r=>(
                <div key={r.id} style={{padding:"8px 0",borderBottom:"1px solid #f3f4f6"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{fontWeight:700,fontSize:12}}>{r.rewardName}</div>
                    <span style={{fontSize:9,fontWeight:700,padding:"1px 7px",borderRadius:8,background:r.status==="used"?"#f3f4f6":r.status==="claimed"?"#f0fdf4":"#fffbeb",color:r.status==="used"?"#6b7280":r.status==="claimed"?"#166534":"#92400e"}}>{r.status.toUpperCase()}</span>
                  </div>
                  <div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>{r.redeemedAt} · {r.pointsCost} pts</div>
                  {r.voucherCode&&(
                    <div style={{display:"flex",alignItems:"center",gap:6,marginTop:6}}>
                      <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,background:"#f9fafb",padding:"3px 8px",borderRadius:6}}>{r.voucherCode}</span>
                      <button onClick={()=>printVoucher(r,detailCust)} style={{padding:"3px 8px",border:"1px solid #e5e7eb",borderRadius:6,background:"#fff",cursor:"pointer",fontSize:10,fontWeight:700,color:"#6b7280"}}><i className="ti ti-printer" style={{fontSize:11}} aria-hidden="true"/> Print</button>
                      {r.status==="unused"&&<button onClick={()=>markVoucherUsed(detailCust,r.id)} style={{padding:"3px 8px",border:"1px solid #e5e7eb",borderRadius:6,background:"#fff",cursor:"pointer",fontSize:10,fontWeight:700,color:"#6b7280"}}>Mark Used</button>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ModalBox>
        </Overlay>
      )}

      {/* ── REDEEM CATALOG PICKER ── */}
      {redeemPick==="__catalog__"&&detailCust&&(
        <Overlay onClose={()=>setRedeemPick(null)}>
          <ModalBox title={`Redeem for ${detailCust.name}`} onClose={()=>setRedeemPick(null)} maxWidth={440}>
            <div style={{fontSize:12,color:"#6b7280",marginBottom:12}}>Balance: <b style={{color:"var(--primary)"}}>{detailCust.loyaltyPoints||0} pts</b></div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {loyaltyRewards.filter(r=>r.active).map(r=>{
                const affordable=(detailCust.loyaltyPoints||0)>=r.pointsCost;
                const inStock=r.type!=="merchandise"||r.stock===null||r.stock>0;
                const disabled=!affordable||!inStock;
                return(
                  <button key={r.id} disabled={disabled} onClick={()=>setRedeemPick(r)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",borderRadius:8,border:"1px solid #e5e7eb",background:disabled?"#f9fafb":"#fff",cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.5:1,textAlign:"left"}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:13}}>{r.name}</div>
                      <div style={{fontSize:11,color:"#9ca3af"}}>{!inStock?"Out of stock":!affordable?"Not enough points":r.type}</div>
                    </div>
                    <div style={{fontWeight:800,fontSize:14,color:"var(--primary)"}}>{r.pointsCost} pts</div>
                  </button>
                );
              })}
              {loyaltyRewards.filter(r=>r.active).length===0&&<div style={{textAlign:"center",padding:20,color:"#9ca3af",fontSize:12}}>No active rewards in the catalog</div>}
            </div>
          </ModalBox>
        </Overlay>
      )}
      {redeemPick&&redeemPick!=="__catalog__"&&(
        <Overlay onClose={()=>setRedeemPick(null)}>
          <ModalBox title="Confirm Redemption" onClose={()=>setRedeemPick(null)} maxWidth={360}>
            <div style={{textAlign:"center",padding:"10px 0 20px"}}>
              <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>{redeemPick.name}</div>
              <div style={{fontSize:13,color:"#6b7280"}}>for {detailCust.name}</div>
              <div style={{fontSize:24,fontWeight:800,color:"var(--primary)",marginTop:10}}>{redeemPick.pointsCost} points</div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setRedeemPick("__catalog__")} style={{flex:1,padding:"10px 0",border:"1px solid #e5e7eb",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700}}>Back</button>
              <button onClick={confirmRedeem} style={{flex:2,padding:"10px 0",background:"var(--primary)",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:800}}>Confirm Redeem</button>
            </div>
          </ModalBox>
        </Overlay>
      )}

      {/* ── FRESHLY-GENERATED VOUCHER DISPLAY (for photo/print) ── */}
      {voucherDisplay&&(
        <div onClick={()=>setVoucherDisplay(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9997,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:28,maxWidth:360,width:"100%",textAlign:"center"}}>
            <div style={{fontSize:11,color:"#9ca3af",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Voucher Issued</div>
            <div style={{fontSize:16,fontWeight:700,marginBottom:2}}>{voucherDisplay.redemption.rewardName}</div>
            <div style={{fontSize:13,color:"#6b7280",marginBottom:18}}>
              {voucherDisplay.redemption.discountType==="fixed" ? `${fmt(voucherDisplay.redemption.discountValue)} off` : `${voucherDisplay.redemption.discountValue}% off${voucherDisplay.redemption.discountCap>0?` (max ${fmt(voucherDisplay.redemption.discountCap)})`:""}`}
            </div>
            <div style={{fontSize:28,fontWeight:800,letterSpacing:3,fontFamily:"monospace",background:"#f9fafb",borderRadius:10,padding:"16px 10px",marginBottom:16}}>{voucherDisplay.redemption.voucherCode}</div>
            <div style={{fontSize:11,color:"#9ca3af",marginBottom:18}}>Screenshot this, or print a copy — either can be used to redeem later.</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setVoucherDisplay(null)} style={{flex:1,padding:"10px 0",border:"1px solid #e5e7eb",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700}}>Close</button>
              <button onClick={()=>printVoucher(voucherDisplay.redemption,voucherDisplay.customer)} style={{flex:2,padding:"10px 0",background:"var(--primary)",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><i className="ti ti-printer" aria-hidden="true"/> Print</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CUSTOMER FORM (add/edit) ── */}
      {custModal&&currentCust&&(
        <Overlay onClose={()=>setCustModal(null)} preventOutsideClose>
          <ModalBox title={custModal==="new"?"Add Customer":"Edit Customer"} onClose={()=>setCustModal(null)}>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <FRow label="First Name"><input autoComplete="off" value={currentCust.firstName||""} onChange={e=>setCurrentCust(c=>({...c,firstName:e.target.value}))} placeholder="First name" style={INP} autoFocus/></FRow>
                <FRow label="Last Name" hint="optional"><input autoComplete="off" value={currentCust.lastName||""} onChange={e=>setCurrentCust(c=>({...c,lastName:e.target.value}))} placeholder="Last name" style={INP}/></FRow>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <FRow label="Phone" hint="optional"><input autoComplete="off" value={currentCust.phone||""} onChange={e=>setCurrentCust(c=>({...c,phone:e.target.value}))} style={INP}/></FRow>
                <FRow label="Email" hint="optional"><input autoComplete="off" type="email" value={currentCust.email||""} onChange={e=>setCurrentCust(c=>({...c,email:e.target.value}))} style={INP}/></FRow>
              </div>
              <FRow label="Birthday" hint="optional — used for birthday discount, if enabled in Loyalty settings"><input autoComplete="off" type="date" value={currentCust.birthday||""} onChange={e=>setCurrentCust(c=>({...c,birthday:e.target.value}))} style={INP}/></FRow>
              <div style={{display:"flex",gap:8,marginTop:4}}>
                <button onClick={()=>setCustModal(null)} style={{flex:1,padding:"10px 0",border:"1px solid #e5e7eb",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700}}>Cancel</button>
                <button onClick={saveCustomer} style={{flex:2,padding:"10px 0",background:"var(--primary)",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:800}}>{custModal==="new"?"Add Customer":"Save Changes"}</button>
              </div>
            </div>
          </ModalBox>
        </Overlay>
      )}

      {/* ── REWARD FORM (add/edit) ── */}
      {rewardModal&&currentReward&&(
        <Overlay onClose={()=>setRewardModal(null)} preventOutsideClose>
          <ModalBox title={rewardModal==="new"?"Add Reward":"Edit Reward"} onClose={()=>setRewardModal(null)}>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <FRow label="Name"><input autoComplete="off" value={currentReward.name} onChange={e=>setCurrentReward(r=>({...r,name:e.target.value}))} placeholder='e.g. "Free T-Shirt (Medium)" or "₱100 Off Voucher"' style={INP} autoFocus/></FRow>
              <FRow label="Type">
                <div style={{display:"flex",gap:8}}>
                  {[{v:"merchandise",l:"Merchandise"},{v:"voucher",l:"Voucher"}].map(t=>(
                    <button key={t.v} onClick={()=>setCurrentReward(r=>({...r,type:t.v}))} style={{flex:1,padding:"9px 0",borderRadius:8,border:`2px solid ${currentReward.type===t.v?"var(--primary)":"#e5e7eb"}`,background:currentReward.type===t.v?"#f5f3ff":"#fff",cursor:"pointer",fontSize:13,fontWeight:700,color:currentReward.type===t.v?"var(--primary)":"#6b7280"}}>{t.l}</button>
                  ))}
                </div>
              </FRow>
              <FRow label="Points Cost"><input autoComplete="off" type="number" value={currentReward.pointsCost} onChange={e=>setCurrentReward(r=>({...r,pointsCost:parseInt(e.target.value)||0}))} style={INP}/></FRow>
              {currentReward.type==="merchandise" ? (
                <>
                  <FRow label="Photo" hint="optional — shows on the reward's catalog card">
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:56,height:56,borderRadius:8,overflow:"hidden",background:"#f9fafb",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        {currentReward.image ? <img src={currentReward.image} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <i className="ti ti-gift" style={{fontSize:22,color:"#d1d5db"}} aria-hidden="true"/>}
                      </div>
                      <label style={{padding:"7px 14px",border:"1px solid #e5e7eb",borderRadius:7,cursor:"pointer",fontSize:12,background:"#f9fafb",fontWeight:700}}>
                        {currentReward.image ? "Change Photo" : "Upload Photo"}
                        <input autoComplete="off" type="file" accept="image/*" onChange={handleRewardImg} style={{display:"none"}}/>
                      </label>
                      {currentReward.image && <button onClick={()=>setCurrentReward(r=>({...r,image:""}))} style={{padding:"7px 10px",border:"1px solid #fecaca",borderRadius:7,cursor:"pointer",fontSize:12,background:"#fef2f2",color:"#dc2626"}}>Remove</button>}
                    </div>
                  </FRow>
                  <FRow label="Stock" hint="leave blank for unlimited"><input autoComplete="off" type="number" value={currentReward.stock??""} onChange={e=>setCurrentReward(r=>({...r,stock:e.target.value===""?null:parseInt(e.target.value)||0}))} placeholder="Unlimited" style={INP}/></FRow>
                </>
              ) : (
                <>
                  <FRow label="Discount Type">
                    <div style={{display:"flex",gap:8}}>
                      {[{v:"fixed",l:"Fixed ₱ Amount"},{v:"percent",l:"Percentage"}].map(t=>(
                        <button key={t.v} onClick={()=>setCurrentReward(r=>({...r,discountType:t.v}))} style={{flex:1,padding:"9px 0",borderRadius:8,border:`2px solid ${currentReward.discountType===t.v?"var(--primary)":"#e5e7eb"}`,background:currentReward.discountType===t.v?"#f5f3ff":"#fff",cursor:"pointer",fontSize:12,fontWeight:700,color:currentReward.discountType===t.v?"var(--primary)":"#6b7280"}}>{t.l}</button>
                      ))}
                    </div>
                  </FRow>
                  {currentReward.discountType==="fixed" ? (
                    <FRow label="Amount Off (₱)"><input autoComplete="off" type="number" value={currentReward.discountValue} onChange={e=>setCurrentReward(r=>({...r,discountValue:parseFloat(e.target.value)||0}))} style={INP}/></FRow>
                  ) : (
                    <>
                      <FRow label="Percent Off (%)" hint="use 100 for a fully free item"><input autoComplete="off" type="number" min={1} max={100} value={currentReward.discountValue} onChange={e=>setCurrentReward(r=>({...r,discountValue:Math.min(100,parseFloat(e.target.value)||0)}))} style={INP}/></FRow>
                      <FRow label="Max Discount Cap (₱)" hint="optional — protects you from an unexpectedly large order"><input autoComplete="off" type="number" value={currentReward.discountCap||""} onChange={e=>setCurrentReward(r=>({...r,discountCap:parseFloat(e.target.value)||0}))} placeholder="No cap" style={INP}/></FRow>
                    </>
                  )}
                </>
              )}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 2px"}}>
                <span style={{fontSize:13,fontWeight:600,color:"#374151"}}>Active in catalog</span>
                <Toggle checked={currentReward.active} onChange={v=>setCurrentReward(r=>({...r,active:v}))} label=""/>
              </div>
              <div style={{display:"flex",gap:8,marginTop:4}}>
                <button onClick={()=>setRewardModal(null)} style={{flex:1,padding:"10px 0",border:"1px solid #e5e7eb",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700}}>Cancel</button>
                <button onClick={saveReward} style={{flex:2,padding:"10px 0",background:"var(--primary)",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:800}}>{rewardModal==="new"?"Add Reward":"Save Changes"}</button>
              </div>
            </div>
          </ModalBox>
        </Overlay>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// INVOICE VIEW
// ════════════════════════════════════════════════════════
// InvoiceView — moved to src/views/InvoiceView.jsx

// InvoiceForm — moved to src/views/InvoiceView.jsx


// Developer: Jandyl
