// Minimal stroke icons (own drawings, no icon library).
const P = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
export const IPlay = () => <svg {...P}><path d="M5 3.5v9l7-4.5z" fill="currentColor" /></svg>;
export const IPause = () => <svg {...P}><path d="M5.5 3.5v9M10.5 3.5v9" /></svg>;
export const IRestart = () => <svg {...P}><path d="M3.5 3.5v9M12.5 3.8 6.5 8l6 4.2z" /></svg>;
export const IComment = () => <svg {...P}><path d="M3 3.5h10v7H7.5L4.5 13v-2.5H3z" /></svg>;
export const IDownload = () => <svg {...P}><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" /></svg>;
export const IBack = () => <svg {...P}><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>;
export const INext = () => <svg {...P}><path d="M6 3.5 10.5 8 6 12.5" /></svg>;
export const IEye = () => <svg {...P}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></svg>;
export const IEyeOff = () => <svg {...P}><path d="M2 2l12 12M6.5 4C7 3.7 7.5 3.5 8 3.5 12 3.5 14.5 8 14.5 8a12 12 0 0 1-1.7 2.2M10.3 11.9c-.7.4-1.5.6-2.3.6C4 12.5 1.5 8 1.5 8a12 12 0 0 1 2.4-2.9" /></svg>;
export const ILock = () => <svg {...P}><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>;
export const IUnlock = () => <svg {...P}><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1" /></svg>;
export const IUp = () => <svg {...P}><path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" /></svg>;
export const IDown = () => <svg {...P}><path d="M8 3.5v9M4.5 9 8 12.5 11.5 9" /></svg>;
export const IUndo = () => <svg {...P}><path d="M5.5 4 2.5 7l3 3M2.5 7h7a4 4 0 0 1 0 8H7" /></svg>;
export const IRedo = () => <svg {...P}><path d="M10.5 4l3 3-3 3M13.5 7h-7a4 4 0 0 0 0 8H9" /></svg>;
export const ITrash = () => <svg {...P}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" /></svg>;
export const IDiamond = ({ filled }: { filled?: boolean }) => (
  <svg {...P} width={12} height={12}><path d="M8 2.5 13.5 8 8 13.5 2.5 8z" fill={filled ? "currentColor" : "none"} /></svg>
);
export const IRecord = () => <svg {...P}><circle cx="8" cy="8" r="4.5" fill="currentColor" stroke="none" /></svg>;
export const IUpload = () => <svg {...P}><path d="M8 11V2.5M4.5 6 8 2.5 11.5 6M3 13.5h10" /></svg>;
export const IGear = () => <svg {...P}><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" /></svg>;
export const IAnchor = () => <svg {...P}><circle cx="8" cy="3.5" r="1.5" /><path d="M8 5v8.5M3 9a5 5 0 0 0 10 0M5.5 7h5" /></svg>;
export const IPlus = () => <svg {...P}><path d="M8 3v10M3 8h10" /></svg>;
