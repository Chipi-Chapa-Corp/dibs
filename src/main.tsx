import React from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import App from './App';
import {ToastProvider} from './lib';
createRoot(document.getElementById('root')!).render(<ToastProvider><App/></ToastProvider>);
