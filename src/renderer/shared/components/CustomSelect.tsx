import type React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/shared/components/ui/select';
import { cn } from '@renderer/shared/lib/utils';

/** 单个下拉选项，支持描述、危险态和禁用态。 */
export type CustomSelectOption = {
  value: string;
  label: string;
  description?: string;
  danger?: boolean;
  disabled?: boolean;
};

/** 兼容旧调用方的下拉框属性。 */
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
 * 下拉框兼容层，内部使用 Radix Select 提供键盘交互、焦点管理和 portal。
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
  const selected = options.find((option) => option.value === value);
  const visibleOptions = options.filter((option) => option.value !== '');

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(nextValue) => onChange(nextValue)}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          compact && 'h-8 min-w-[84px] rounded-full px-3 text-xs',
          className
        )}
      >
        <SelectValue placeholder={selected?.label || placeholder} />
      </SelectTrigger>
      <SelectContent>
        {visibleOptions.length === 0 ? (
          <div className="px-2 py-2 text-sm text-muted-foreground">暂无选项</div>
        ) : (
          visibleOptions.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className={cn(
                option.danger && 'text-destructive data-[highlighted]:text-destructive'
              )}
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate">{option.label}</span>
                {option.description ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
