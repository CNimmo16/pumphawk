import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { Station } from "@pump-hawk/openapi/types";
import {
  stationPriceComparison,
  stationPriceMedian,
} from "../lib/station-prices";
import "leaflet/dist/leaflet.css";
export function StationMap({
  location,
  stations,
  selected,
  onSelect,
}: {
  location: { latitude: number; longitude: number };
  stations: Station[];
  selected: string[];
  onSelect: (id: string) => void;
}) {
  const element = useRef<HTMLDivElement>(null),
    map = useRef<LeafletMap | null>(null),
    layer = useRef<LayerGroup | null>(null);
  const [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false);
  const median = stationPriceMedian(stations);
  useEffect(() => {
    let disposed = false;
    void import("leaflet")
      .then((L) => {
        if (disposed || !element.current) return;
        const m = L.map(element.current, { scrollWheelZoom: false }).setView(
          [location.latitude, location.longitude],
          12,
        );
        map.current = m;
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(m);
        L.circle([location.latitude, location.longitude], {
          radius: 8046.72,
          color: "#ffffff",
          weight: 4,
          opacity: 1,
          fillColor: "#244d3a",
          fillOpacity: 0.035,
          dashArray: "8 6",
        }).addTo(m);
        L.circleMarker([location.latitude, location.longitude], {
          radius: 6,
          fillColor: "#244d3a",
          fillOpacity: 1,
          color: "white",
          weight: 2,
        })
          .addTo(m)
          .bindTooltip("Your search location");
        layer.current = L.layerGroup().addTo(m);
        setLoaded(true);
      })
      .catch(() => setFailed(true));
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
      layer.current = null;
      setLoaded(false);
    };
  }, [location.latitude, location.longitude]);
  useEffect(() => {
    if (!loaded || !layer.current) return;
    let disposed = false;
    void import("leaflet").then((L) => {
      if (disposed || !layer.current) return;
      layer.current.clearLayers();
      stations.forEach((s) => {
        const { band, description } = stationPriceComparison(
          s.pricePence,
          median,
        );
        const label = `${s.name}, ${s.pricePence?.toFixed(1) ?? "—"} pence per litre, ${description}${selected.includes(s.id) ? ", selected" : ""}`;
        const icon = L.divIcon({
          className: `station-pin price-${band} ${selected.includes(s.id) ? "selected" : ""}`,
          html: `${s.pricePence?.toFixed(1) ?? "—"}<small>p</small>`,
          iconSize: [58, 30],
          iconAnchor: [29, 30],
        });
        const tooltip = document.createElement("span");
        tooltip.textContent = label;
        const marker = L.marker([s.latitude, s.longitude], {
          icon,
          title: label,
          alt: label,
          keyboard: true,
          riseOnHover: true,
          riseOffset: 10000,
        })
          .on("click", () => onSelect(s.id))
          .bindTooltip(tooltip)
          .addTo(layer.current!);
        marker.getElement()?.setAttribute("aria-label", label);
        marker
          .getElement()
          ?.setAttribute("aria-pressed", String(selected.includes(s.id)));
      });
    });
    return () => {
      disposed = true;
    };
  }, [loaded, stations, selected, onSelect, median]);
  return (
    <div className="map-wrap">
      <div
        ref={element}
        className="station-map"
        aria-label="Map of E10 petrol prices within five miles"
      />
      {median != null && (
        <div className="station-map-legend">
          <strong>Nearby median: {median.toFixed(1)}p/L</strong>
          <div>
            <span>
              <i className="price-low" aria-hidden="true" />
              More than 1p below
            </span>
            <span>
              <i className="price-typical" aria-hidden="true" />
              Within 1p
            </span>
            <span>
              <i className="price-high" aria-hidden="true" />
              More than 1p above
            </span>
          </div>
          <small>
            Compared with all stations in your five-mile search. Outlined labels
            are selected.
          </small>
        </div>
      )}
      {failed && (
        <p role="alert" className="form-error">
          The map couldn’t load. You can still choose from the station list
          below.
        </p>
      )}
    </div>
  );
}
