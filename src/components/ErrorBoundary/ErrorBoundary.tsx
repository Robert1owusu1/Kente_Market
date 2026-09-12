import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo } = this.state;
      const isProd = import.meta.env.PROD;
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
        }}>
          <h1 style={{ fontSize: '3rem', marginBottom: '1rem', color: '#f59e0b' }}>Something went wrong</h1>
          <p style={{ fontSize: '1.1rem', marginBottom: '1rem', color: '#6b7280', maxWidth: '500px' }}>
            An unexpected error occurred while loading this page. Please try refreshing.
          </p>
          {!isProd && (
            <pre style={{
              background: '#1f2937', color: '#f59e0b', padding: '1rem', borderRadius: '8px',
              maxWidth: '100%', overflowX: 'auto', textAlign: 'left', fontSize: '0.8rem', marginBottom: '1rem',
            }}>
              {error && error.message}
              {'\n\n'}
              {errorInfo && errorInfo.componentStack}
            </pre>
          )}
          <button
            onClick={this.handleReload}
            style={{
              padding: '0.75rem 2rem',
              backgroundColor: '#f59e0b',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1rem',
              cursor: 'pointer',
            }}
          >
            Refresh Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
