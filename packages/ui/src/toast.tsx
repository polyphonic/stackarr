'use client';

import toast, { Toaster } from 'react-hot-toast';

export { toast };

export function StackarrToaster() {
  return (
    <Toaster
      gutter={8}
      position="bottom-right"
      toastOptions={{
        duration: 4500,
        style: {
          background: 'var(--panel-bg, #ffffff)',
          border: '1px solid var(--border, #d7dee8)',
          borderRadius: '6px',
          boxShadow: 'var(--modal-shadow, 0 24px 90px rgb(22 30 45 / 16%))',
          color: 'var(--text, #172033)',
          fontSize: '0.875rem',
          lineHeight: '1.35',
          maxWidth: '420px',
          padding: '0.75rem 0.85rem'
        },
        success: {
          iconTheme: {
            primary: 'var(--success, #16a34a)',
            secondary: 'var(--panel-bg, #ffffff)'
          }
        },
        error: {
          iconTheme: {
            primary: 'var(--danger, #dc2626)',
            secondary: 'var(--panel-bg, #ffffff)'
          }
        },
        loading: {
          duration: Infinity
        }
      }}
    />
  );
}
