
import os

BASE_DIR = "/opt/isync/frontend/src/pages"
CURRENT_FILE = os.path.join(BASE_DIR, "BatchGenerator.tsx")
BACKUP_FILE = os.path.join(BASE_DIR, "BatchGenerator.tsx.bak")

def restore():
    print(f"Reading current file {CURRENT_FILE}")
    with open(CURRENT_FILE, 'r') as f:
        current_content = f.read()
    
    print(f"Reading backup file {BACKUP_FILE}")
    with open(BACKUP_FILE, 'r') as f:
        backup_content = f.read()

    # Extract Wizard Block
    start_marker = "{/* Sync Pair Wizard Modal */}"
    start_idx = backup_content.find(start_marker)
    
    if start_idx == -1:
        # Try finding by code
        start_marker = "showWizard && ("
        start_idx = backup_content.find(start_marker)
        # Backtrack to comment if possible
        # Assumes content around it
    
    if start_idx == -1:
        print("Error: Wizard start not found in backup")
        return

    # Find end. We determined it ends around line 1530 with '            )}'
    # We can search for the start of User Summary Modal as the boundary
    user_summary_marker = "{/* User Summary Modal */}"
    end_idx = backup_content.find(user_summary_marker)
    
    if end_idx == -1:
        print("Error: User Summary Modal marker not found in backup")
        return
        
    wizard_block = backup_content[start_idx:end_idx]
    
    # Analyze the end of wizard_block
    # It should end with ')}' and newlines.
    # We want to insert '</div>' before ')}'
    
    # Find the last ')}' in the block
    last_brace_idx = wizard_block.rfind(')}')
    
    if last_brace_idx != -1:
        # Insert </div> before it
        # Maintain indentation (16 spaces)
        insertion = "                </div>\n" # 16 spaces
        # Wait, if we slice at last_brace_idx, we put insertion before it.
        # But we need newline before insertion too?
        # The line before ends with </div> (indent 20)
        
        chunk_before = wizard_block[:last_brace_idx]
        chunk_after = wizard_block[last_brace_idx:]
        
        fixed_wizard_block = chunk_before + insertion + chunk_after
        print("Fixed Wizard Block by adding missing </div>")
    else:
        print("Warning: Could not find closing ')}' in wizard block")
        fixed_wizard_block = wizard_block

    # Inject into Current File
    # Placeholder: {showWizard && (<div>Wizard Placeholder</div>)}
    # Or strict match of what I replaced:
    # "{showWizard && (<div>Wizard Placeholder</div>)}"
    # Wait, I used sed to insert '{showWizard && (<div>Wizard Placeholder</div>)}' at line 1293.
    # It might not match exactly due to indentation I typed in sed vs file.
    # I should find the placeholder by a substring.
    
    placeholder_sig = "<div>Wizard Placeholder</div>"
    
    if placeholder_sig in current_content:
        # We need to replace the whole block {showWizard ... }
        # start of placeholder block
        # It's line based insertion.
        # sed inserted it on its own line?
        
        # easier to replace the line containing the placeholder
        lines = current_content.splitlines()
        new_lines = []
        replaced = False
        for line in lines:
            if placeholder_sig in line:
                new_lines.append(fixed_wizard_block.rstrip()) # Insert block
                replaced = True
            else:
                new_lines.append(line)
        
        full_content = "\n".join(new_lines)
    else:
        print("Error: Placeholder not found in current file")
        return

    with open(CURRENT_FILE, 'w') as f:
        f.write(full_content)
    
    print(f" injected Wizard Modal. Size: {len(full_content)}")

if __name__ == "__main__":
    restore()
