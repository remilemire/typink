import { useState } from 'react';
import type { ExportFormat, ExportOptions, PaperTheme } from '@shared/types';

interface Props {
  initialFormat: ExportFormat;
  currentPage: number;
  pageCount: number;
  hasAnnotations: boolean;
  onExport(options: ExportOptions): void;
  onClose(): void;
}

export function ExportDialog(props: Props) {
  const [format, setFormat] = useState<ExportFormat>(props.initialFormat);
  const [theme, setTheme] = useState<PaperTheme>('light');
  const [annotations, setAnnotations] = useState(true);
  const [pages, setPages] = useState<'all' | 'current' | 'range'>('all');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(props.pageCount || 1);
  const [dpi, setDpi] = useState(200);
  const [quality, setQuality] = useState(90);
  const raster = format !== 'pdf';

  const submit = () =>
    props.onExport({
      format,
      theme,
      annotations,
      dpi,
      quality: quality / 100,
      pages: pages === 'range' ? { from, to } : pages,
      currentPage: props.currentPage,
    });

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-label="Export"
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onClose();
          if (e.key === 'Enter') submit();
        }}
      >
        <h3>Export note</h3>
        <div className="field">
          <span>Format</span>
          <div className="segmented">
            {(['pdf', 'png', 'jpeg'] as const).map((f) => (
              <button key={f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)} style={{ padding: '0 12px' }}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Paper</span>
          <div className="segmented">
            {(['light', 'dark'] as const).map((t) => (
              <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)} style={{ padding: '0 12px' }}>
                {t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
        {raster && (
          <>
            <div className="field">
              <span>Pages</span>
              <select className="select" value={pages} onChange={(e) => setPages(e.target.value as typeof pages)}>
                <option value="all">All pages</option>
                <option value="current">Current page ({props.currentPage})</option>
                <option value="range">Range…</option>
              </select>
            </div>
            {pages === 'range' && (
              <div className="field">
                <span>From page</span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="number" min={1} max={props.pageCount} value={from} onChange={(e) => setFrom(Number(e.target.value))} />
                  to
                  <input type="number" min={from} max={props.pageCount} value={to} onChange={(e) => setTo(Number(e.target.value))} />
                </span>
              </div>
            )}
            <div className="field">
              <span>Resolution</span>
              <select className="select" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                <option value={144}>144 dpi (screen)</option>
                <option value={200}>200 dpi</option>
                <option value={300}>300 dpi (print)</option>
              </select>
            </div>
            {format === 'jpeg' && (
              <div className="field">
                <span>Quality</span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="range" min={50} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
                  <span className="muted" style={{ width: 30 }}>{quality}%</span>
                </span>
              </div>
            )}
          </>
        )}
        {props.hasAnnotations && (
          <label className="field">
            <span>Include handwritten annotations</span>
            <input type="checkbox" checked={annotations} onChange={(e) => setAnnotations(e.target.checked)} />
          </label>
        )}
        <div className="modal-actions">
          <button className="ghost-button" onClick={props.onClose}>
            Cancel
          </button>
          <button className="primary-button" onClick={submit} autoFocus>
            Export…
          </button>
        </div>
      </div>
    </div>
  );
}
