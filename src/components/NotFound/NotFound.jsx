import React from 'react';
import { Link } from 'react-router-dom';

const NotFound = () => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      textAlign: 'center',
      padding: '2rem',
      fontFamily: 'system-ui, sans-serif',
      backgroundColor: '#0f172a',
      color: '#f9fafb',
    }}>
      <h1 style={{ fontSize: '6rem', margin: 0, color: '#f59e0b', fontWeight: 800 }}>404</h1>
      <h2 style={{ fontSize: '1.5rem', margin: '0.5rem 0' }}>Page Not Found</h2>
      <p style={{ fontSize: '1.1rem', margin: '1rem 0 2rem', color: '#9ca3af' }}>
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link
        to="/"
        style={{
          padding: '0.75rem 2rem',
          backgroundColor: '#f59e0b',
          color: '#fff',
          borderRadius: '8px',
          textDecoration: 'none',
          fontWeight: 600,
        }}
      >
        Go Home
      </Link>
    </div>
  );
};

export default NotFound;
