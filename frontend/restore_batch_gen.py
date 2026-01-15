
import os

def restore():
    # 1. Read the clean header/handlers from current file
    with open('/opt/isync/frontend/src/pages/BatchGenerator.tsx', 'r') as f:
        current_content = f.read()

    # Find the split point
    split_marker = "// Placeholder to continue"
    if split_marker not in current_content:
        print("Error: Split marker not found in current file")
        return
    
    header_part = current_content.split(split_marker)[0]

    # 2. Read the JSX from backup
    with open('/opt/isync/frontend/src/pages/BatchGenerator.tsx.bak', 'r') as f:
        backup_content = f.read()
    
    # Find start of JSX (return ()
    start_marker = "return ("
    start_idx = backup_content.find(start_marker)
    if start_idx == -1:
        print("Error: return ( not found in backup")
        return
    
    jsx_part = backup_content[start_idx:]

    # 3. Restore Push Modal
    push_modal_code = """                    {/* Push Modal */}
                    {showPushModal && (
                        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-sm shadow-2xl">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                    <Server size={20} className="text-cyan-400" />
                                    Push to Remote
                                </h3>
                                <p className="text-sm text-zinc-400 mb-4">
                                    Pushing <span className="font-mono text-white">{pushTargetId}</span> to remote server.
                                </p>

                                <div className="mb-6">
                                    <label className="block text-xs text-zinc-500 mb-1">Select Server</label>
                                    <select
                                        value={selectedServerId}
                                        onChange={(e) => setSelectedServerId(e.target.value)}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm"
                                    >
                                        {sshServers.map(s => (
                                            <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex gap-2 justify-end">
                                    <button
                                        onClick={() => setShowPushModal(false)}
                                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handlePush}
                                        disabled={pushing}
                                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
                                    >
                                        {pushing ? 'Pushing...' : 'Push'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}"""
    
    # Replace the removed marker or just insert if marker strictly matches
    # The backup has "{/* Push Modal Removed */}"
    
    if "{/* Push Modal Removed */}" in jsx_part:
        jsx_part = jsx_part.replace("{/* Push Modal Removed */}", push_modal_code)
    else:
        # Fallback: Insert before the last closing divs if marker missing
        # But we saw it in the view_file, so it should be there.
        print("Warning: Push Modal Removed marker not found, attempting to locate end of file...")
        pass

    # 4. Combine
    # Note: header_part ends right before "Placeholder..."
    # jsx_part starts with "return ("
    # We need to ensure we don't duplicate or miss newlines
    
    full_content = header_part + "\n    " + jsx_part

    # Write back
    with open('/opt/isync/frontend/src/pages/BatchGenerator.tsx', 'w') as f:
        f.write(full_content)
    
    print("Successfully restored BatchGenerator.tsx")

if __name__ == "__main__":
    restore()
