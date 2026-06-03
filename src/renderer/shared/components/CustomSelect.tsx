import { useEffect, useId, useRef, useState } from 'react';
import type React from 'react';

export type CustomSelectOption = {
  value: string;
  label: string;
  description?: string;
  danger?: boolean;
  disabled?: boolean;
};

export type CustomSelectProps = {
  value: string;
  options: CustomSelectOption[];
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  onChange: (value: string) => void;
};

/**
 * 自制下拉框组件——替代浏览器原生 `<select>`。
 *
 * 支持当前值显示、禁用、选中态、描述文字、危险选项、
 * 点击外部关闭和 Escape 关闭。
 */
export function CustomSelect({
  value,
  options,
  placeholder = '选择',
  ariaLabel,
  disabled,
  className = '',
  compact,
  onChange,
}: CustomSelectProps): React.ReactElement {
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.value === value);
  const label = (selected?.label ?? value) || placeholder;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function selectValue(nextValue: string): void {
    if (disabled) return;
    const option = options.find((item) => item.value === nextValue);
    if (!option || option.disabled) return;

    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div
      ref={rootRef}
      className={`custom-select ${compact ? 'compact' : ''} ${open ? 'open' : ''} ${className}`.trim()}
    >
      <button
        type="button"
        className="custom-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="custom-select-label">{label}</span>
        <span className="custom-select-chevron" aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </button>

      {open ? (
        <div
          id={`${id}-listbox`}
          className="custom-select-popover"
          role="listbox"
        >
          {options.length === 0 ? (
            <div className="custom-select-empty">暂无选项</div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`custom-select-option ${option.value === value ? 'selected' : ''} ${option.danger ? 'danger' : ''}`.trim()}
                disabled={option.disabled}
                onClick={() => selectValue(option.value)}
              >
                <span className="custom-select-option-label">
                  {option.label}
                </span>
                {option.description ? (
                  <span className="custom-select-option-desc">
                    {option.description}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/** 下拉箭头图标。 */
function ChevronDownIcon(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="m6 9 6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
