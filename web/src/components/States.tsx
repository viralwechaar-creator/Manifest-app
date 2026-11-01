export const Loading = ({ label = 'Loading' }: { label?: string }) => <div className="center" role="status" aria-label={label}><div className="spinner" /></div>;
export const ErrorBox = ({ message }: { message: string }) => <div className="notice error" role="alert">{message}</div>;
export const Empty = ({ children }: { children: React.ReactNode }) => <div className="empty">{children}</div>;
