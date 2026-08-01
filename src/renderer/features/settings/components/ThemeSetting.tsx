import type React from 'react';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { RadioGroup, RadioGroupItem } from '@renderer/shared/components/ui/radio-group';

const themeOptions = [
  { value: 'system', label: '自动', icon: MonitorIcon },
  { value: 'light', label: '明亮', icon: SunIcon },
  { value: 'dark', label: '暗黑', icon: MoonIcon },
] as const;

/** 设置应用的显示模式，并持久化用户选择。 */
export function ThemeSetting(): React.ReactElement {
  const { theme, setTheme } = useTheme();
  const selectedTheme = theme === 'light' || theme === 'dark' ? theme : 'system';

  return (
    <div className="grid min-h-12 grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
      <div className="grid min-w-0 gap-1">
        <strong className="text-sm font-medium text-foreground">外观</strong>
        <span className="text-xs leading-5 text-muted-foreground">自动模式会跟随系统的明亮或暗黑设置。</span>
      </div>
      <RadioGroup
        className="grid grid-cols-3 gap-1 justify-self-start rounded-lg bg-muted p-1 sm:justify-self-end"
        value={selectedTheme}
        aria-label="外观模式"
        onValueChange={setTheme}
      >
        {themeOptions.map((option) => {
          const Icon = option.icon;

          return (
            <RadioGroupItem
              key={option.value}
              value={option.value}
              aria-label={option.label}
              title={option.label}
              className="group flex h-8 w-auto items-center gap-1.5 rounded-md border-0 px-2.5 text-xs text-muted-foreground transition-colors data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-sm [&_[data-slot=radio-group-indicator]]:hidden"
            >
              <Icon aria-hidden="true" className="size-3" />
              <span>{option.label}</span>
            </RadioGroupItem>
          );
        })}
      </RadioGroup>
    </div>
  );
}
