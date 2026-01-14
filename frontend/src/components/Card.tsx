import React from 'react';

interface CardProps {
    children: React.ReactNode;
    className?: string;
    padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingMap = {
    none: '',
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
};

/**
 * Consistent card/section component used across all pages
 */
export const Card: React.FC<CardProps> = ({
    children,
    className = '',
    padding = 'md'
}) => {
    return (
        <div className={`bg-zinc-900 border border-zinc-800 rounded-xl ${paddingMap[padding]} ${className}`}>
            {children}
        </div>
    );
};

interface CardHeaderProps {
    children: React.ReactNode;
    className?: string;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ children, className = '' }) => {
    return (
        <div className={`text-sm font-bold text-zinc-400 uppercase tracking-wider mb-4 border-b border-zinc-800 pb-2 ${className}`}>
            {children}
        </div>
    );
};

export default Card;
