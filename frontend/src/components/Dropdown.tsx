import React, { useState, ReactNode } from 'react';

interface DropdownProps {
    trigger: ReactNode;
    children: ReactNode;
    className?: string;
    menuClassName?: string;
    align?: 'left' | 'right';
    fullWidth?: boolean;  // Whether to take full container width
}

/**
 * Reusable Dropdown component with click-outside-to-close behavior.
 * 
 * Usage:
 * <Dropdown
 *     trigger={<button>Open Menu</button>}
 *     align="right"
 * >
 *     <button onClick={...}>Option 1</button>
 *     <button onClick={...}>Option 2</button>
 * </Dropdown>
 */
export const Dropdown = ({ 
    trigger, 
    children, 
    className = '',
    menuClassName = '',
    align = 'left',
    fullWidth = false
}: DropdownProps) => {
    const [open, setOpen] = useState(false);

    return (
        <div className={`relative ${fullWidth ? 'w-full' : 'inline-block'} ${className}`}>
            {/* Trigger element - clicking toggles dropdown */}
            <div onClick={() => setOpen(!open)}>
                {trigger}
            </div>

            {/* Dropdown content */}
            {open && (
                <>
                    {/* Invisible backdrop to catch clicks outside */}
                    <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => setOpen(false)}
                    />
                    {/* Menu content */}
                    <div className={`
                        absolute top-full mt-2 z-50 min-w-full whitespace-nowrap
                        bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl
                        ${align === 'right' ? 'right-0' : 'left-0'}
                        ${menuClassName}
                    `}>
                        {/* Pass close function to children if needed */}
                        {typeof children === 'function' 
                            ? (children as (close: () => void) => ReactNode)(() => setOpen(false))
                            : children
                        }
                    </div>
                </>
            )}
        </div>
    );
};

interface DropdownItemProps {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    variant?: 'default' | 'danger' | 'warning';
}

/**
 * Dropdown menu item with consistent styling.
 */
export const DropdownItem = ({ 
    children, 
    onClick, 
    disabled = false,
    className = '',
    variant = 'default'
}: DropdownItemProps) => {
    const variantClasses = {
        default: 'text-zinc-300 hover:bg-zinc-800 hover:text-white',
        danger: 'text-red-400 hover:bg-zinc-800 hover:text-red-300',
        warning: 'text-amber-400 hover:bg-zinc-800 hover:text-amber-300'
    };

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
                w-full text-left px-4 py-2 text-sm transition
                flex items-center gap-2
                disabled:opacity-50 disabled:cursor-not-allowed
                ${variantClasses[variant]}
                ${className}
            `}
        >
            {children}
        </button>
    );
};

export const DropdownDivider = () => (
    <div className="border-t border-zinc-700 my-1" />
);

export default Dropdown;
