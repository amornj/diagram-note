import { X } from 'lucide-react';

interface HotkeyHelpProps {
  onClose: () => void;
}

const ROWS: { keys: string; label: string }[] = [
  { keys: '1', label: 'Toggle left pane' },
  { keys: '2', label: 'Toggle right pane' },
  { keys: '3 / 4', label: 'Cycle group members' },
  { keys: '5', label: 'Search' },
  { keys: '6', label: 'New study box (rectangle)' },
  { keys: '7', label: 'Group builder' },
  { keys: '8', label: 'New polyline / region' },
  { keys: '9', label: 'Lock zoom' },
  { keys: '0  ·  Home', label: 'Reset view' },
  { keys: '+ / − / wheel', label: 'Zoom' },
  { keys: 'Space + drag', label: 'Pan' },
  { keys: '/', label: 'Focus search' },
  { keys: 'B', label: 'Split compare' },
  { keys: '?', label: 'This help' },
  { keys: 'Esc', label: 'Cancel current draw / close popup' },
];

export default function HotkeyHelp({ onClose }: HotkeyHelpProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100"
            aria-label="Close help"
          >
            <X size={16} />
          </button>
        </div>
        <table className="mt-4 w-full text-sm">
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.keys} className="border-t border-slate-100 first:border-t-0">
                <td className="py-1.5 pr-3 font-mono text-xs text-slate-600">
                  {row.keys}
                </td>
                <td className="py-1.5 text-slate-700">{row.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 text-[11px] text-slate-400">
          Press <kbd className="rounded border border-slate-300 bg-white px-1 py-px text-[10px]">Esc</kbd> or click outside to close.
        </div>
      </div>
    </div>
  );
}
