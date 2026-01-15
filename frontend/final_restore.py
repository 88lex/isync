
import os

BASE_DIR = "/opt/isync/frontend/src/pages"
CURRENT_FILE = os.path.join(BASE_DIR, "BatchGenerator.tsx")
BACKUP_FILE = os.path.join(BASE_DIR, "BatchGenerator.tsx.bak")

def restore():
    print(f"Reading logic from {CURRENT_FILE}")
    with open(CURRENT_FILE, 'r') as f:
        current_content = f.read()
    
    if 'return (' not in current_content:
        print("Error: 'return (' not found in current file")
        return

    logic_part = current_content.split('return (')[0]
    
    print(f"Reading JSX from {BACKUP_FILE}")
    with open(BACKUP_FILE, 'r') as f:
        backup_content = f.read()

    inner_start_marker = 'className="space-y-6 animate-in fade-in zoom-in-95 duration-300"'
    inner_start_idx = backup_content.find(inner_start_marker)
    
    if inner_start_idx == -1:
        print("Error: Inner content marker not found in backup")
        return
        
    tag_start = backup_content.rfind('<div', 0, inner_start_idx)
    
    export_index = backup_content.rfind('export default BatchGenerator;')
    
    # Grab from tag_start to end
    raw_body_chunk = backup_content[tag_start:export_index]
    
    # We need to remove ONLY the ");\n};" part at the end.
    # We DO NOT remove the last </div> because the backup seems to be missing one closing tag.
    # So we keep whatever divs are there, and our Manual Wrapper Closer will serve as the missing one.
    
    # Find );
    close_paren_idx = raw_body_chunk.rfind(');')
    if close_paren_idx == -1:
        print("Error: Could not find ); in body chunk")
        return
        
    body_content = raw_body_chunk[:close_paren_idx]
    
    # Strip whitespace/newlines from end to be clean
    body_content = body_content.rstrip()
    
    # Inject Push Modal (if placeholder present)
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

    placeholder = "{/* Push Modal Removed */}"
    if placeholder in body_content:
        body_content = body_content.replace(placeholder, push_modal_code)

    manual_header = """
            {/* Header */}
            <PageHeader
                icon={FileCode}
                title="Batch Generator"
                subtitle="Generate and execute rclone commands"
                gradient="from-amber-600 to-orange-600"
            />
"""

    final_jsx = f"""return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
{manual_header}
{body_content}
        </div>
    );
}};
"""
    
    full_content = logic_part + final_jsx + "\nexport default BatchGenerator;\n"

    with open(CURRENT_FILE, 'w') as f:
        f.write(full_content)
    
    print(f"Restored BatchGenerator.tsx (Preserving Modals div). Size: {len(full_content)}")

if __name__ == "__main__":
    restore()
