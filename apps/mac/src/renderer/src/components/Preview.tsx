import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { splitTypstSvg, stripTextLayer, type SvgPage } from '@shared/svgPages';
import type { AnnotationOverlay, BlockAnchor, Diagnostic, PreviewResult, SketchPlacement } from '@shared/types';
import { Icon } from './Icon';

const PX_PER_PT = 96 / 72;

interface Props {
  result: PreviewResult | null;
  failed: PreviewResult | null;
  zoom: number | 'fit';
  showAnnotations: boolean;
  deviceConnected: boolean;
  onEditSketch(id: string): void;
  onRevealSketch(id: string): void;
  onJumpToError(d: Diagnostic): void;
  /** A click on the page: jump to the source of the text block under it. */
  onJumpToText(text: string): void;
  onPageChange(page: number): void;
  onFitScale(scale: number): void;
}

export function Preview(props: Props) {
  const { result, failed, zoom } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  const split = useMemo(() => (result?.svg ? splitTypstSvg(result.svg) : null), [result?.svg]);
  const defs = useMemo(() => (split ? stripTextLayer(split.defs) : ''), [split]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const widest = split ? Math.max(...split.pages.map((p) => p.width)) : 595;
  const fit = Math.max(0.2, Math.min(2, (width - 56) / (widest * PX_PER_PT)));
  const factor = zoom === 'fit' ? fit : zoom;
  const scale = factor * PX_PER_PT;

  const { onFitScale } = props;
  useEffect(() => {
    onFitScale(fit);
  }, [fit, onFitScale]);

  // Report the page under the middle of the viewport (used by "Export current page").
  const { onPageChange } = props;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const mid = el.scrollTop + el.clientHeight / 2;
      const pages = el.querySelectorAll<HTMLElement>('.page');
      let current = 1;
      pages.forEach((p, i) => {
        if (p.offsetTop <= mid) current = i + 1;
      });
      onPageChange(current);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [onPageChange]);

  const sketchesByPage = useMemo(() => groupByPage(result?.sketches ?? []), [result?.sketches]);
  const annotationsByPage = useMemo(() => groupByPage(result?.annotations ?? []), [result?.annotations]);
  const error = failed?.diagnostics.find((d) => d.severity === 'error');
  const dark = result?.theme === 'dark';

  return (
    <div className="pane-preview">
      {error && (
        <button className="preview-status" onClick={() => props.onJumpToError(error)} title={error.message}>
          <Icon name="warning" size={14} />
          <span>{error.message.split('\n')[0]}</span>
        </button>
      )}
      <div className="preview-scroll" ref={scroller}>
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: defs }} />
        {split ? (
          <div className="preview-pages">
            {split.pages.map((page, i) => (
              <Page
                key={i}
                page={page}
                scale={scale}
                dark={dark}
                sketches={sketchesByPage.get(i + 1)}
                annotations={props.showAnnotations ? annotationsByPage.get(i + 1) : undefined}
                deviceConnected={props.deviceConnected}
                onEditSketch={props.onEditSketch}
                onRevealSketch={props.onRevealSketch}
                onClickPoint={(x, y) => {
                  const block = blockAt(result?.blocks ?? [], i + 1, y);
                  if (block?.text) props.onJumpToText(block.text);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="preview-empty">{failed ? 'Fix the error to see your note' : 'Rendering…'}</div>
        )}
      </div>
    </div>
  );
}

/** The text block whose top is closest above `y` on the page. */
function blockAt(blocks: BlockAnchor[], page: number, y: number): BlockAnchor | undefined {
  let best: BlockAnchor | undefined;
  for (const b of blocks) if (b.page === page && b.y <= y + 4 && (!best || b.y >= best.y)) best = b;
  return best;
}

function groupByPage<T extends { page: number }>(items: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) map.set(item.page, [...(map.get(item.page) ?? []), item]);
  return map;
}

interface PageProps {
  page: SvgPage;
  scale: number;
  dark: boolean;
  sketches?: SketchPlacement[];
  annotations?: AnnotationOverlay[];
  deviceConnected: boolean;
  onEditSketch(id: string): void;
  onRevealSketch(id: string): void;
  onClickPoint(x: number, y: number): void;
}

const Page = memo(function Page({
  page,
  scale,
  dark,
  sketches,
  annotations,
  deviceConnected,
  onEditSketch,
  onRevealSketch,
  onClickPoint,
}: PageProps) {
  const body = useMemo(() => stripTextLayer(page.body), [page.body]);
  return (
    <div
      className={`page${dark ? ' dark' : ''}`}
      style={{ width: page.width * scale, height: page.height * scale }}
      onClick={(e) => {
        if (e.target !== e.currentTarget && !(e.target as Element).closest('svg')) return;
        const r = e.currentTarget.getBoundingClientRect();
        onClickPoint((e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
      }}
    >
      <PageSvg tid={page.tid} width={page.width} height={page.height} body={body} />
      {annotations && annotations.length > 0 && (
        <div className="annotation-layer">
          {annotations.map((a) => (
            <img
              key={a.id}
              src={dark ? a.urlDark : a.url}
              alt=""
              style={{ left: a.x * scale, top: a.y * scale, width: a.w * scale, height: a.h * scale }}
            />
          ))}
        </div>
      )}
      {sketches?.map((s) => (
        <div
          key={s.id}
          className="hotspot"
          style={{ left: s.x * scale, top: s.y * scale, width: s.w * scale, height: s.h * scale }}
          onDoubleClick={() => onEditSketch(s.id)}
          onClick={() => onRevealSketch(s.id)}
          title="Double-click to draw on your iPad"
        >
          <div className="hotspot-actions">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEditSketch(s.id);
              }}
            >
              <Icon name="pencil" size={12} /> {deviceConnected ? 'Edit on iPad' : 'Connect iPad'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});

// Only re-parse the SVG markup when the page content actually changed.
const PageSvg = memo(
  function PageSvg({ width, height, body }: { tid: string; width: number; height: number; body: string }) {
    return <svg viewBox={`0 0 ${width} ${height}`} fill="none" dangerouslySetInnerHTML={{ __html: body }} />;
  },
  (a, b) => a.tid === b.tid && a.width === b.width && a.height === b.height,
);
