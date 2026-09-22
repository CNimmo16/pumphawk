import type { ColorValue } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { colors } from "../lib/theme";
export type IconName = "home" | "pin" | "user" | "hawk";
export function Icon({
  name,
  color = colors.forest,
  size = 24,
}: {
  name: IconName;
  color?: ColorValue;
  size?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox={name === "hawk" ? "0 0 38 38" : "0 0 24 24"}
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "home" && (
        <>
          <Path d="m3 10 9-7 9 7v10H3Z" />
          <Path d="M9 20v-7h6v7" />
        </>
      )}
      {name === "pin" && (
        <>
          <Path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
          <Path d="M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </>
      )}
      {name === "user" && (
        <>
          <Path d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
          <Path d="M4 21v-2a8 8 0 0 1 16 0v2" />
        </>
      )}
      {name === "hawk" && (
        <>
          <Rect width={38} height={38} rx={11} fill="#244d3a" stroke="none" />
          <Path
            d="M7 11l12 5 12-5-5 10-7 8-7-8z"
            fill="#d5ef9b"
            stroke="none"
          />
          <Path d="M12 17l7 3 7-3-7 9z" fill="#244d3a" stroke="none" />
          <Path d="M18 17h4l-3 5z" fill="white" stroke="none" />
        </>
      )}
    </Svg>
  );
}
