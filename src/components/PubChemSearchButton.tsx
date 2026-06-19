const PUBCHEM_ICON_URL =
  'https://pubchem.ncbi.nlm.nih.gov/pcfe/favicon/apple-touch-icon.png';

export default function PubChemSearchButton({ query }: { query: string }) {
  const searchTerm = query.trim();

  const openPubChemSearch = () => {
    if (!searchTerm) return;
    const url = `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(searchTerm)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      type="button"
      onClick={openPubChemSearch}
      disabled={!searchTerm}
      className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white transition hover:border-sky-300 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
      title={searchTerm ? `Search PubChem for “${searchTerm}”` : 'Search PubChem'}
      aria-label={searchTerm ? `Search PubChem for ${searchTerm}` : 'Search PubChem'}
    >
      <img
        src={PUBCHEM_ICON_URL}
        alt=""
        className="h-5 w-5 object-contain"
        referrerPolicy="no-referrer"
      />
    </button>
  );
}
