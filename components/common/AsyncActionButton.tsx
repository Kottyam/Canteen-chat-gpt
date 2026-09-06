import React from 'react';

type AsyncActionButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingLabel?: string;
  children: React.ReactNode;
};

export const AsyncActionButton: React.FC<AsyncActionButtonProps> = ({
  loading = false,
  loadingLabel,
  children,
  disabled,
  className = '',
  type = 'button',
  ...props
}) => (
  <button
    {...props}
    type={type}
    disabled={disabled || loading}
    aria-busy={loading}
    data-loading={loading ? 'true' : undefined}
    className={`${className} ${loading ? 'cursor-wait opacity-70' : ''}`.trim()}
  >
    {loading ? (
      <span className="inline-flex items-center justify-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
        <span>{loadingLabel || 'Processing…'}</span>
      </span>
    ) : children}
  </button>
);

export default AsyncActionButton;
