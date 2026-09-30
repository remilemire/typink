import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import type { HubStatus } from '@shared/types';

interface Props {
  hub: HubStatus | null;
  onRevoke(id: string): void;
  onClose(): void;
}

export function DevicesPopover({ hub, onRevoke, onClose }: Props) {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!hub?.qrPayload) return setQr(null);
    let alive = true;
    void QRCode.toDataURL(hub.qrPayload, { margin: 0, width: 264, errorCorrectionLevel: 'M' }).then((url) => alive && setQr(url));
    return () => {
      alive = false;
    };
  }, [hub?.qrPayload]);

  const connected = hub?.devices.filter((d) => d.connected) ?? [];

  return (
    <>
      <div className="scrim" onMouseDown={onClose} />
      <div className="popover devices">
        <h4>{connected.length ? `Connected to ${connected.map((d) => d.name).join(', ')}` : 'Connect your iPad'}</h4>
        {hub?.error ? (
          <p style={{ color: 'var(--danger)' }}>{hub.error}</p>
        ) : (
          <>
            <p>
              Open <b>Typink</b> on your iPad (same Wi‑Fi). Pick this Mac and enter the code, or scan the QR code if it
              doesn't show up.
            </p>
            <div className="pair-code" aria-label="Pairing code">
              {(hub?.pairingCode ?? '······').split('').map((c, i) => (
                <span key={i}>{c}</span>
              ))}
            </div>
            {qr && (
              <div className="qr">
                <img src={qr} alt="Pairing QR code" />
              </div>
            )}
            {hub && (
              <p className="muted" style={{ textAlign: 'center', marginBottom: 8 }}>
                {hub.host} · {hub.addresses[0] ?? 'no network'} · port {hub.port}
              </p>
            )}
            {connected.length === 0 && (
              <p className="muted" style={{ textAlign: 'center', marginBottom: 8 }}>
                iPad can't connect? Allow Typink to accept incoming connections in System Settings › Network ›
                Firewall.
              </p>
            )}
          </>
        )}
        {hub?.devices.map((d) => (
          <div key={d.id} className="device-row">
            <span className={`device-dot${d.connected ? ' on' : ''}`} />
            <span className="name">{d.name}</span>
            <span className="muted">{d.connected ? 'Connected' : 'Paired'}</span>
            <button className="link-button" onClick={() => onRevoke(d.id)}>
              Forget
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
