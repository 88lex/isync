import { useState, useCallback } from 'react';

/**
 * Custom hook for managing Set-based toggle state
 * Eliminates repeated toggle logic across components
 */
export function useSetToggle<T>(initial: Set<T> | (() => Set<T>)) {
    const [set, setSet] = useState<Set<T>>(initial);
    
    const toggle = useCallback((item: T) => {
        setSet(prev => {
            const next = new Set(prev);
            if (next.has(item)) {
                next.delete(item);
            } else {
                next.add(item);
            }
            return next;
        });
    }, []);
    
    const add = useCallback((item: T) => {
        setSet(prev => new Set(prev).add(item));
    }, []);
    
    const remove = useCallback((item: T) => {
        setSet(prev => {
            const next = new Set(prev);
            next.delete(item);
            return next;
        });
    }, []);
    
    const clear = useCallback(() => {
        setSet(new Set());
    }, []);
    
    const addAll = useCallback((items: T[]) => {
        setSet(new Set(items));
    }, []);
    
    const has = useCallback((item: T) => set.has(item), [set]);
    
    return {
        set,
        setSet,
        toggle,
        add,
        remove,
        clear,
        addAll,
        has,
        size: set.size,
        values: Array.from(set),
    };
}

export default useSetToggle;
