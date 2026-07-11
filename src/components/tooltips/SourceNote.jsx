// Muted provenance line appended to chart hover tooltips. Text comes from
// calcDefinitions.mjs getSourceNote(key) — one shared rendering so styling
// stays consistent across every chart tooltip.
const SourceNote = ({ sourceNote }) =>
  sourceNote ? (
    <p className="mt-1.5 pt-1.5 border-t border-gray-100 text-[11px] text-gray-500 max-w-[280px]">
      {sourceNote}
    </p>
  ) : null;

export default SourceNote;
