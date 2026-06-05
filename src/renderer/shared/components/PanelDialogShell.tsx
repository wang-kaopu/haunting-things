import type React from 'react';

type PanelDialogShellBaseProps = {
  open: boolean;
  titleId: string;
  title: string;
  description?: string;
  closeLabel: string;
  closeDisabled?: boolean;
  closeOnBackdrop?: boolean;
  className?: string;
  children: React.ReactNode;
  onClose: () => void;
};

export type PanelDialogShellProps =
  | (PanelDialogShellBaseProps & {
      as?: 'section';
      onSubmit?: never;
    })
  | (PanelDialogShellBaseProps & {
      as: 'form';
      onSubmit: React.FormEventHandler<HTMLFormElement>;
    });

/** 共享面板式弹窗骨架，统一遮罩、模糊背景、标题区和关闭按钮。 */
export function PanelDialogShell(props: PanelDialogShellProps): React.ReactElement | null {
  if (!props.open) return null;

  const surfaceClassName = `panel-dialog ${props.className ?? ''}`.trim();
  const header = (
    <header className="panel-dialog-header">
      <div>
        <h2 id={props.titleId}>{props.title}</h2>
        {props.description ? <p>{props.description}</p> : null}
      </div>

      <button
        type="button"
        className="panel-dialog-close-button"
        aria-label={props.closeLabel}
        onClick={props.onClose}
        disabled={props.closeDisabled}
      >
        ×
      </button>
    </header>
  );

  return (
    <div
      className="panel-dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (props.closeOnBackdrop && event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      {props.as === 'form' ? (
        <form
          className={surfaceClassName}
          role="dialog"
          aria-modal="true"
          aria-labelledby={props.titleId}
          onSubmit={props.onSubmit}
        >
          {header}
          {props.children}
        </form>
      ) : (
        <section
          className={surfaceClassName}
          role="dialog"
          aria-modal="true"
          aria-labelledby={props.titleId}
        >
          {header}
          {props.children}
        </section>
      )}
    </div>
  );
}
