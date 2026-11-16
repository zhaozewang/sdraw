export const ToolButton = ({ onClick, icon: Icon, title, active, disabled, className: extraClass }: {
    onClick: () => void;
    icon: any;
    title: string;
    active?: boolean;
    disabled?: boolean;
    className?: string;
  }) => (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-accent/10 text-accent'
          : disabled
          ? 'text-gray-300 dark:text-on-surface-disabled cursor-not-allowed'
          : 'text-gray-600 dark:text-on-surface-secondary hover:bg-toolbar-hover hover:text-gray-900 dark:hover:text-on-surface-primary'
      } ${extraClass || ''}`}

    >
      <Icon size={16} />
    </button>
  );

