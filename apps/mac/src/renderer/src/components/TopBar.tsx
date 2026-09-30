import type { HubStatus, NoteSettings, Template, ViewMode } from '@shared/types';
import { Icon, type IconName } from './Icon';

interface Props {
  sidebar: boolean;
  onShowSidebar(): void;
  notePath: string | null;
  settings: NoteSettings | null;
  onSettings(patch: Partial<NoteSettings>): void;
  onMoreSettings(anchor: DOMRect): void;
  viewMode: ViewMode;
  onViewMode(mode: ViewMode): void;
  hub: HubStatus | null;
  onDevices(): void;
  onExport(): void;
}

const TEMPLATES: { value: Template; icon: IconName; label: string }[] = [
  { value: 'blank', icon: 'blank', label: 'Blank' },
  { value: 'lined', icon: 'lined', label: 'Lined' },
  { value: 'grid', icon: 'grid', label: 'Grid' },
  { value: 'dotted', icon: 'dotted', label: 'Dotted' },
];

const VIEWS: { value: ViewMode; icon: IconName; label: string }[] = [
  { value: 'editor', icon: 'editor', label: 'Editor only' },
  { value: 'split', icon: 'split', label: 'Editor and preview' },
  { value: 'preview', icon: 'preview', label: 'Preview only' },
];

export function TopBar(props: Props) {
  const { settings, notePath, hub } = props;
  const name = notePath?.split('/').pop()?.replace(/\.typ$/, '') ?? 'Typink';
  const folder = notePath?.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
  const connected = hub?.devices.some((d) => d.connected) ?? false;

  return (
    <header className={`topbar${props.sidebar ? '' : ' no-sidebar'}`}>
      {!props.sidebar && (
        <button className="icon-button" onClick={props.onShowSidebar} title="Show sidebar (⌥⌘S)">
          <Icon name="sidebar" />
        </button>
      )}
      <div className="title">
        {folder && <span className="folder">{folder} / </span>}
        {name}
      </div>
      <div className="spacer" />

      {settings && (
        <>
          <div className="segmented" role="radiogroup" aria-label="Paper">
            {TEMPLATES.map((t) => (
              <button
                key={t.value}
                className={settings.template === t.value ? 'on' : ''}
                title={`${t.label} paper`}
                onClick={() => props.onSettings({ template: t.value })}
              >
                <Icon name={t.icon} />
              </button>
            ))}
          </div>
          <select
            className="select"
            value={settings.paper}
            title="Paper size"
            onChange={(e) => props.onSettings({ paper: e.target.value as NoteSettings['paper'] })}
          >
            <option value="a4">A4</option>
            <option value="us-letter">US Letter</option>
            <option value="endless">Endless</option>
          </select>
          <button className="icon-button" title="Font, size and spacing" onClick={(e) => props.onMoreSettings(e.currentTarget.getBoundingClientRect())}>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: 14 }}>Aa</span>
          </button>
          <div className="sep" />
        </>
      )}

      <button className={`icon-button${connected ? ' active' : ''}`} onClick={props.onDevices} title={connected ? 'iPad connected' : 'Connect your iPad'}>
        <span className={`device-dot${connected ? ' on' : ''}`} />
        <Icon name="ipad" />
      </button>
      <div className="segmented" role="radiogroup" aria-label="View">
        {VIEWS.map((v) => (
          <button key={v.value} className={props.viewMode === v.value ? 'on' : ''} title={`${v.label} (⌘\\)`} onClick={() => props.onViewMode(v.value)}>
            <Icon name={v.icon} />
          </button>
        ))}
      </div>
      <button className="icon-button" onClick={props.onExport} disabled={!notePath} title="Export (⌘P)">
        <Icon name="export" />
      </button>
    </header>
  );
}
