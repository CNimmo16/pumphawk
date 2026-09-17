import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

type Point = { x: number; y: number };
type Placement = Point & {
  height: number;
  maxHeight: number;
  width: number;
  anchor: Point;
  side: "left" | "right" | "top" | "bottom";
};
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

export function ForecastTooltip({
  anchor,
  children,
}: {
  anchor: RefObject<SVGCircleElement | null>;
  children: ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const tooltip = element.current;
    const point = anchor.current;
    if (!tooltip || !point) return;
    function update() {
      if (!tooltip || !point) return;
      const bounds = point.getBoundingClientRect();
      const target = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };
      const padding = 12,
        gap = 18;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      if (
        target.y < 0 ||
        target.y > viewportHeight ||
        target.x < 0 ||
        target.x > viewportWidth
      ) {
        setPlacement(null);
        return;
      }
      const width = tooltip.getBoundingClientRect().width;
      const height =
        (content.current?.scrollHeight ?? tooltip.scrollHeight) + 2;
      const verticalX = clamp(
        target.x - width / 2,
        padding,
        viewportWidth - width - padding,
      );
      const horizontalY = clamp(
        target.y - height / 2,
        padding,
        viewportHeight - height - padding,
      );
      const horizontalRoom = viewportHeight - padding * 2;
      const candidates = [
        {
          side: "left" as const,
          x: target.x - gap - width,
          y: horizontalY,
          room: horizontalRoom,
        },
        {
          side: "right" as const,
          x: target.x + gap,
          y: horizontalY,
          room: horizontalRoom,
        },
        {
          side: "bottom" as const,
          x: verticalX,
          y: target.y + gap,
          room: viewportHeight - padding - target.y - gap,
        },
        {
          side: "top" as const,
          x: verticalX,
          y: target.y - gap - height,
          room: target.y - gap - padding,
        },
      ].filter(
        (candidate) =>
          candidate.x >= padding &&
          candidate.x + width <= viewportWidth - padding &&
          candidate.room > 0,
      );
      const candidate =
        candidates.find((candidate) => height <= candidate.room) ??
        candidates.sort((a, b) => b.room - a.room)[0];
      if (!candidate) {
        setPlacement(null);
        return;
      }
      const visibleHeight = Math.min(height, candidate.room);
      setPlacement({
        x: candidate.x,
        y:
          candidate.side === "top"
            ? target.y - gap - visibleHeight
            : candidate.y,
        width,
        height: visibleHeight,
        maxHeight: candidate.room,
        side: candidate.side,
        anchor: target,
      });
    }
    update();
    const observer = new ResizeObserver(update);
    observer.observe(tooltip);
    if (point.ownerSVGElement) observer.observe(point.ownerSVGElement);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, children]);

  return createPortal(
    <div
      ref={element}
      id="forecast-tooltip"
      role="tooltip"
      className="forecast-tooltip"
      data-placement={placement?.side}
      style={{
        left: placement?.x ?? 0,
        top: placement?.y ?? 0,
        maxHeight: placement?.maxHeight,
        visibility: placement ? "visible" : "hidden",
      }}
    >
      {placement && (
        <span
          className="forecast-tooltip-arrow"
          aria-hidden="true"
          style={
            placement.side === "left" || placement.side === "right"
              ? {
                  top:
                    clamp(
                      placement.anchor.y - placement.y,
                      16,
                      placement.height - 16,
                    ) - 6,
                }
              : {
                  left:
                    clamp(
                      placement.anchor.x - placement.x,
                      16,
                      placement.width - 16,
                    ) - 6,
                }
          }
        />
      )}
      <div
        ref={content}
        className="forecast-tooltip-content"
        style={{ maxHeight: placement ? placement.maxHeight - 2 : undefined }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
