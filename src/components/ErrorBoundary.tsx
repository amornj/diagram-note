import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('diagram-note UI crashed', error, errorInfo);
  }

  private handleReload = () => window.location.reload();

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-50">
          <div className="max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl">
            <h1 className="text-xl font-semibold">Editor error</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              The interface hit an unrecovered error. Reloading the page usually restores
              the editor — your data is persisted in IndexedDB.
            </p>
            {this.state.message && (
              <p className="mt-3 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-300">
                {this.state.message}
              </p>
            )}
            <button
              onClick={this.handleReload}
              className="mt-5 rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
