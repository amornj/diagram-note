import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../lib/store';
import { normalizeTagInput, parseMemberKey } from '../lib/workspace';
import { COLOR_SWATCHES } from './sharedControls';

interface DrawToolsProps {
  mode: 'group' | 'studybox' | 'polyline';
  groupBuilderFocusSignal?: number;
  onRequestClose?: () => void;
}

export default function DrawTools({
  mode,
  groupBuilderFocusSignal = 0,
  onRequestClose,
}: DrawToolsProps) {
  const [groupName, setGroupName] = useState('');
  const [groupTagsInput, setGroupTagsInput] = useState('');
  const [showGroupNumbers, setShowGroupNumbers] = useState(false);
  const [showGroupOnLoad, setShowGroupOnLoad] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const groupNameInputRef = useRef<HTMLInputElement>(null);

  const workspace = useEditorStore((s) => s.workspace);
  const editorMode = useEditorStore((s) => s.editorMode);
  const draftOverlayColor = useEditorStore((s) => s.draftOverlayColor);
  const draftGroupKeys = useEditorStore((s) => s.draftGroupKeys);
  const setSelectedPrimitiveId = useEditorStore((s) => s.setSelectedPrimitiveId);
  const setEditorMode = useEditorStore((s) => s.setEditorMode);
  const setDraftOverlayColor = useEditorStore((s) => s.setDraftOverlayColor);
  const clearDraftPolygon = useEditorStore((s) => s.clearDraftPolygon);
  const createGroupPrimitive = useEditorStore((s) => s.createGroupPrimitive);
  const clearDraftGroup = useEditorStore((s) => s.clearDraftGroup);
  const removeDraftGroupMember = useEditorStore((s) => s.removeDraftGroupMember);
  const reorderDraftGroupMember = useEditorStore((s) => s.reorderDraftGroupMember);

  const primitivesById = new Map(workspace.primitives.map((p) => [p.id, p]));

  const handleCreateGroup = () => {
    const created = createGroupPrimitive(
      groupName,
      [],
      normalizeTagInput(groupTagsInput),
      showGroupNumbers,
      showGroupOnLoad
    );
    if (!created) return;
    setGroupName('');
    setGroupTagsInput('');
    setShowGroupNumbers(false);
    setShowGroupOnLoad(false);
  };

  const handleStartGroupCollect = () => {
    setEditorMode(editorMode === 'groupCollect' ? 'none' : 'groupCollect');
  };

  const handleClose = () => {
    if (mode === 'group' && editorMode === 'groupCollect') {
      clearDraftGroup();
      setEditorMode('none');
    }
    if (mode === 'polyline' && editorMode === 'polygon') {
      clearDraftPolygon();
      setEditorMode('none');
    }
    if (mode === 'studybox' && editorMode === 'rectangle') {
      setEditorMode('none');
    }
    onRequestClose?.();
  };

  useEffect(() => {
    if (groupBuilderFocusSignal === 0) return;
    setEditorMode('groupCollect');
    setSelectedPrimitiveId(null);
    window.dispatchEvent(new Event('map-search-clear'));
    window.requestAnimationFrame(() => {
      groupNameInputRef.current?.focus();
      groupNameInputRef.current?.select();
    });
  }, [groupBuilderFocusSignal, setEditorMode, setSelectedPrimitiveId]);

  const showGroupSection = mode === 'group';
  const showStudyBoxSection = mode === 'studybox';
  const showPolylineSection = mode === 'polyline';
  const headerLabel = showGroupSection
    ? 'Group builder'
    : showStudyBoxSection
      ? 'New Study box'
      : 'New polyline/shape';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-900">{headerLabel}</div>
        {onRequestClose && (
          <button
            onClick={handleClose}
            className="rounded-full border border-gray-200 p-1.5 text-gray-500 transition hover:bg-gray-50"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showGroupSection && (
        <div className="mt-2">
          <input
            ref={groupNameInputRef}
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="Group name"
            className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-sky-300"
          />
          <div className="mt-3">
            {editorMode === 'groupCollect' ? (
              <span className="text-xs text-gray-500">click on map to add member</span>
            ) : (
              <button
                onClick={handleStartGroupCollect}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 transition"
              >
                <Plus className="h-3.5 w-3.5" />
                Collecting on map
              </button>
            )}
          </div>
          {draftGroupKeys.length > 0 ? (
            <div className="mt-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                Picked
              </div>
              <div className="space-y-1">
                {draftGroupKeys.map((memberKey, index) => {
                  const member = parseMemberKey(memberKey);
                  const label = member
                    ? primitivesById.get(member.id)?.name ?? memberKey
                    : memberKey;
                  return (
                    <div
                      key={memberKey}
                      draggable
                      onDragStart={() => setDraggedIndex(index)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (draggedIndex === null) return;
                        reorderDraftGroupMember(draggedIndex, index);
                        setDraggedIndex(null);
                      }}
                      onDragEnd={() => setDraggedIndex(null)}
                      className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                          {index + 1}
                        </span>
                        <span className="truncate">{label}</span>
                      </div>
                      <button
                        onClick={() => removeDraftGroupMember(memberKey)}
                        className="rounded-full p-1 text-gray-400 transition hover:bg-gray-200 hover:text-gray-700"
                        aria-label={`Remove ${label}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mt-3 text-xs text-gray-400">
              {editorMode === 'groupCollect'
                ? 'Click primitives on the map to add them.'
                : 'Pick primitives on the map.'}
            </div>
          )}
          <input
            value={groupTagsInput}
            onChange={(event) => setGroupTagsInput(event.target.value)}
            placeholder="Tags, separated by commas"
            className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-sky-300"
          />
          <label className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={showGroupNumbers}
              onChange={(event) => setShowGroupNumbers(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
            />
            Show member numbers on map
          </label>
          <label className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={showGroupOnLoad}
              onChange={(event) => setShowGroupOnLoad(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
            />
            Show on load
          </label>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleCreateGroup}
              disabled={draftGroupKeys.length === 0}
              className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              Save group
            </button>
            <button
              onClick={clearDraftGroup}
              disabled={draftGroupKeys.length === 0}
              className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:cursor-not-allowed disabled:text-gray-300"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {(showStudyBoxSection || showPolylineSection) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              onClick={() => setDraftOverlayColor(color)}
              className={`h-7 w-7 rounded-full border-2 transition ${
                draftOverlayColor === color
                  ? 'border-slate-900 scale-105'
                  : 'border-white'
              }`}
              style={{ backgroundColor: color }}
              aria-label={`Set color ${color}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
