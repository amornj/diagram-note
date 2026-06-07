import { Check, Share2 } from 'lucide-react';
import { useState } from 'react';
import { buildDiagramDeepLink } from '../lib/deepLinks';

export default function CopyDeepLinkButton({
  mapId,
  label,
}: {
  mapId: string | null | undefined;
  label: string;
}) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    if (!mapId) return;
    const url = buildDiagramDeepLink({ mapId });
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={() => void copyLink()}
      disabled={!mapId}
      className={`rounded-md p-1.5 transition-colors ${
        copied
          ? 'bg-emerald-50 text-emerald-600'
          : 'text-gray-500 hover:bg-gray-100'
      } disabled:cursor-not-allowed disabled:opacity-40`}
      title={copied ? 'Link copied' : label}
      aria-label={copied ? 'Link copied' : label}
    >
      {copied ? <Check size={18} /> : <Share2 size={18} />}
    </button>
  );
}
