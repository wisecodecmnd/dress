import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, one throwing component unmounts the whole tree and the visitor
 * gets a blank page. Scoped around the routed content so the navigation and
 * footer survive.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ui] render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;

    if (!error) return this.props.children;

    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
        <span className="mb-4 text-meta uppercase text-denim">Something broke</span>
        <h1 className="mb-4 font-display text-display-md">This page didn't load.</h1>
        <p className="mb-8 max-w-md text-mist">
          The rest of the site still works. Reload to try this page again.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <button
            onClick={() => window.location.reload()}
            className="bg-pearl px-8 py-4 text-meta uppercase text-obsidian transition-colors hover:bg-white"
          >
            Reload
          </button>
          <button
            onClick={() => this.setState({ error: null })}
            className="border border-stone/50 px-8 py-4 text-meta uppercase text-mist transition-colors hover:border-pearl hover:text-pearl"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }
}
