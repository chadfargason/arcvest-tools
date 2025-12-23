'use client';

import { useEffect, useState } from 'react';

export default function OAuthReturn() {
  const [status, setStatus] = useState('Completing authentication...');

  useEffect(() => {
    // The OAuth flow works as follows:
    // 1. User clicks to connect account in Plaid Link
    // 2. For OAuth institutions, user is redirected to bank's site
    // 3. After authenticating, bank redirects back here with oauth_state_id
    // 4. Plaid Link (in the parent window) detects this and completes the flow

    // Check if we have the oauth_state_id parameter
    const urlParams = new URLSearchParams(window.location.search);
    const oauthStateId = urlParams.get('oauth_state_id');

    if (oauthStateId) {
      setStatus('Authentication successful! Returning to Portfolio X-Ray...');

      // If opened in same window (not popup), redirect back to main page
      // Plaid Link will pick up the oauth_state_id from the URL
      setTimeout(() => {
        // Redirect to the main portfolio-x-ray page with the oauth params
        // Plaid Link will automatically detect and continue the flow
        window.location.href = `/portfolio-x-ray${window.location.search}`;
      }, 1000);
    } else {
      // No oauth_state_id - might be a direct visit or error
      setStatus('Redirecting to Portfolio X-Ray...');
      setTimeout(() => {
        window.location.href = '/portfolio-x-ray';
      }, 1500);
    }
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      backgroundColor: '#f5f5f5',
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '2rem 3rem',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        textAlign: 'center',
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '3px solid #e0e0e0',
          borderTopColor: '#0a2540',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 1rem',
        }} />
        <p style={{
          margin: 0,
          color: '#333',
          fontSize: '1rem',
        }}>
          {status}
        </p>
      </div>
      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
