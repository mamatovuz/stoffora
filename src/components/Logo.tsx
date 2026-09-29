import mark from "../assets/staffora-mark.svg";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="logo">
      <img src={mark} alt="" aria-hidden="true" />
      {!compact && <b>STAFFORA</b>}
    </div>
  );
}
