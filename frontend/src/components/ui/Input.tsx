import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    inputSize?: 'sm' | 'md';
}

export const Input: React.FC<InputProps> = ({
    label,
    error,
    inputSize = 'md',
    className = '',
    ...props
}) => {
    const sizeClass = inputSize === 'sm' ? 'h-7 text-xs px-2' : 'h-8 text-sm px-2.5';

    return (
        <div className="w-full">
            {label && (
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                    {label}
                </label>
            )}
            <input
                className={`w-full bg-zinc-900 border border-zinc-700 rounded-md text-zinc-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition placeholder-zinc-500 ${sizeClass} ${error ? 'border-red-500' : ''} ${className}`}
                {...props}
            />
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
        </div>
    );
};

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: string;
    error?: string;
}

export const Textarea: React.FC<TextareaProps> = ({
    label,
    error,
    className = '',
    ...props
}) => {
    return (
        <div className="w-full">
            {label && (
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                    {label}
                </label>
            )}
            <textarea
                className={`w-full px-2.5 py-2 bg-zinc-900 border border-zinc-700 rounded-md text-zinc-100 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition resize-none placeholder-zinc-500 ${error ? 'border-red-500' : ''} ${className}`}
                {...props}
            />
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
        </div>
    );
};

export default Input;
