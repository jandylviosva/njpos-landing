import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ReviewForm from './ReviewForm.jsx';

const isReviewPage = window.location.pathname.replace(/\/$/, '') === '/leave-a-review';

createRoot(document.getElementById('root')).render(isReviewPage ? <ReviewForm/> : <App/>);
