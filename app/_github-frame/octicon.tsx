import { ICONS, type IconName } from "./icon-paths";

type IconProps = {
  name: IconName;
  size?: number;
  className?: string;
};

// Decorative inline SVG. Nothing here is focusable or interactive.
export function Icon({ name, size = 16, className }: IconProps) {
  const icon = ICONS[name];
  return (
    <svg
      className={className}
      viewBox={icon.viewBox}
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {icon.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
