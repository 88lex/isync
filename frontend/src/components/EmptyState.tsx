import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
    icon: LucideIcon;
    title: string;
    description?: string;
    action?: {
        label: string;
        onClick: () => void;
    };
}

/**
 * Consistent empty state component for lists/tables with no data
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
    icon: Icon,
    title,
    description,
    action
}) => {
    return (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
            <Icon className="mx-auto text-zinc-600 mb-4" size={48} />
            <h3 className="text-lg font-medium text-zinc-400 mb-2">{title}</h3>
            {description && (
                <p className="text-sm text-zinc-500 mb-4">{description}</p>
            )}
            {action && (
                <button
                    onClick={action.onClick}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition text-sm"
                >
                    {action.label}
                </button>
            )}
        </div>
    );
};

export default EmptyState;
