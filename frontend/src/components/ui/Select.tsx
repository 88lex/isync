import React from 'react';

interface SelectOption {
    value: string;
    label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
    label?: string;
    options: SelectOption[];
    placeholder?: string;
    selectSize?: 'sm' | 'md';
}

export const Select: React.FC<SelectProps> = ({
    label,
    options,
    placeholder,
    selectSize = 'md',
    className = '',
    ...props
}) => {
    const sizeClass = selectSize === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm';

    return (
        <div className="w-full">
            {label && (
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                    {label}
                </label>
            )}
            <select
                className={`w-full px-2.5 bg-zinc-900 border border-zinc-700 rounded-md text-zinc-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition appearance-none cursor-pointer ${sizeClass} ${className}`}
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                    backgroundPosition: 'right 0.5rem center',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '1.25em 1.25em',
                    paddingRight: '2rem',
                }}
                {...props}
            >
                {placeholder && (
                    <option value="" disabled>
                        {placeholder}
                    </option>
                )}
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
        </div>
    );
};

export default Select;
