import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'next-themes';
import { App } from '@renderer/app/App';
import '@renderer/styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="haunting-things-theme"
    >
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
