export function BrandHeader({ title = '회원관리', subtitle, actions }) {
  return (
    <header className="brand-header">
      <a className="brand" href="#/" aria-label="회원관리 홈">
        <span className="brand-mark">YW</span>
        <span>
          <strong>{title}</strong>
          {subtitle && <small>{subtitle}</small>}
        </span>
      </a>
      {actions && <nav className="header-actions" aria-label="빠른 메뉴">{actions}</nav>}
    </header>
  );
}

export function PageTitle({ eyebrow, title, description, side }) {
  return (
    <div className="page-title">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {side && <div className="page-title-side">{side}</div>}
    </div>
  );
}

export function Notice({ type = 'info', children, onClose }) {
  if (!children) return null;
  return (
    <div className={`notice ${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <span className="notice-dot" aria-hidden="true" />
      <div>{children}</div>
      {onClose && <button className="icon-button" type="button" onClick={onClose} aria-label="알림 닫기">×</button>}
    </div>
  );
}

export function BusyOverlay({ show, label = '처리하고 있습니다' }) {
  if (!show) return null;
  return (
    <div className="busy-overlay" role="status" aria-live="polite">
      <div className="busy-box"><span className="spinner" />{label}</div>
    </div>
  );
}

export function Modal({ title, children, onClose, wide = false }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <section className={`modal-panel ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2>{onClose && <button type="button" className="icon-button" onClick={onClose} aria-label="닫기">×</button>}</header>
        {children}
      </section>
    </div>
  );
}

export function EmptyState({ title, description }) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">·</span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

export function StatusBadge({ children, tone = 'neutral' }) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

export function Field({ label, required, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span>{label}{required && <b className="required">필수</b>}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = '확인', danger = false, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="modal-message">{message}</p>
      <div className="button-row end">
        <button type="button" className="button ghost" onClick={onCancel}>취소</button>
        <button type="button" className={`button ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
