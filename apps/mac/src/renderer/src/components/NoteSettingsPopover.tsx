import type { NoteSettings } from '@shared/types';

interface Props {
  anchor: DOMRect;
  settings: NoteSettings;
  onChange(patch: Partial<NoteSettings>): void;
  onClose(): void;
}

const FONTS = [
  { value: 'serif', label: 'Serif (Libertinus)' },
  { value: 'sans', label: 'Sans (Helvetica Neue)' },
  { value: 'modern', label: 'Modern (Computer Modern)' },
  { value: 'mono', label: 'Mono' },
];

export function NoteSettingsPopover({ anchor, settings, onChange, onClose }: Props) {
  const left = Math.min(anchor.left, window.innerWidth - 300);
  return (
    <>
      <div className="scrim" onMouseDown={onClose} />
      <div className="popover" style={{ left, top: anchor.bottom + 6, width: 284 }}>
        <Row label="Template">
          <select className="select" value={settings.template} onChange={(e) => onChange({ template: e.target.value as NoteSettings['template'] })}>
            <option value="blank">Blank</option>
            <option value="lined">Lined</option>
            <option value="grid">Grid</option>
            <option value="dotted">Dotted</option>
          </select>
        </Row>
        <Row label="Paper">
          <select className="select" value={settings.paper} onChange={(e) => onChange({ paper: e.target.value as NoteSettings['paper'] })}>
            <option value="a4">A4</option>
            <option value="us-letter">US Letter</option>
            <option value="endless">Endless (one long page)</option>
          </select>
        </Row>
        <Row label="Font">
          <select className="select" value={settings.font} onChange={(e) => onChange({ font: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
            {!FONTS.some((f) => f.value === settings.font) && <option value={settings.font}>{settings.font}</option>}
          </select>
        </Row>
        <Row label="Size">
          <select className="select" value={String(settings.size)} onChange={(e) => onChange({ size: Number(e.target.value) })}>
            {[9, 10, 10.5, 11, 12, 13, 14, 16].map((s) => (
              <option key={s} value={s}>
                {s} pt
              </option>
            ))}
          </select>
        </Row>
        <Row label="Line spacing">
          <select className="select" value={settings.spacing} onChange={(e) => onChange({ spacing: e.target.value as NoteSettings['spacing'] })}>
            <option value="compact">Compact</option>
            <option value="normal">Normal</option>
            <option value="wide">Wide</option>
          </select>
        </Row>
        <Row label="Margins">
          <select className="select" value={settings.margins} onChange={(e) => onChange({ margins: e.target.value as NoteSettings['margins'] })}>
            <option value="narrow">Narrow</option>
            <option value="normal">Normal</option>
            <option value="wide">Wide</option>
          </select>
        </Row>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span>{label}</span>
      {children}
    </div>
  );
}
