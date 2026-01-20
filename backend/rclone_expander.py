import re
from typing import List, Dict, Optional, Tuple
from pydantic import BaseModel

class ExpansionProposal(BaseModel):
    new_remote_name: str
    new_drive_name: str
    based_on_remote: str
    service_account_file: Optional[str] = None
    team_drive_id: Optional[str] = None # Source drive ID to copy permissions from

class UnionAnalysis(BaseModel):
    union_name: str
    upstreams: List[str]
    detected_pattern: Optional[str] = None # e.g. "books-{n}"
    next_index: Optional[int] = None
    members: List[Dict[str, str]] # List of member remotes with their config
    
def parse_upstreams(upstream_str: str) -> List[str]:
    """Parse the 'upstreams' config string from rclone union."""
    # Format is usually "remote1:path remote2:path"
    # We want just the remote names generally, or keep paths?
    # Usually for expansion we assume root paths or consistent paths.
    
    # Split by space
    parts = upstream_str.strip().split(' ')
    remotes = []
    for p in parts:
        if not p: continue
        # strip path if present? e.g. "remote1:sub" -> "remote1"
        # But wait, rclone config stores it as "remote1:path" usually.
        # We need the remote name to look up its config.
        # Rclone remote names shouldn't contain commands, but might contain colons?
        # Actually usually it's "Name:Path".
        if ':' in p:
             rname = p.split(':')[0]
             remotes.append(rname)
        else:
             remotes.append(p)
    return remotes

def analyze_union(remotes_map: Dict[str, Dict[str, str]], union_name: str) -> UnionAnalysis:
    """
    Analyze a union remote to determine its members and naming pattern.
    """
    if union_name not in remotes_map:
        raise ValueError(f"Union remote '{union_name}' not found")
        
    union_config = remotes_map[union_name]
    if union_config.get('type') != 'union':
        raise ValueError(f"Remote '{union_name}' is not a union")
        
    upstreams_str = union_config.get('upstreams', '')
    upstream_names = parse_upstreams(upstreams_str)
    
    members = []
    for name in upstream_names:
        if name in remotes_map:
            # Add full config + name
            cfg = remotes_map[name].copy()
            cfg['name'] = name
            members.append(cfg)
    
    # Detect Pattern
    # Look for "base-01", "base-02" etc.
    # Group by similarity?
    
    pattern = None
    next_idx = None
    
    if members:
        # Sort by name
        sorted_members = sorted(members, key=lambda x: x['name'])
        last_member = sorted_members[-1]
        last_name = last_member['name']
        
        # Regex for Name-Number
        match = re.search(r'^(.*?)(\d+)$', last_name)
        if match:
            base = match.group(1)
            num_str = match.group(2)
            num_len = len(num_str)
            current_num = int(num_str)
            
            # Verify other members match this pattern?
            # For now, simplistic approach: Just increment the last one found.
            pattern = f"{base}{{zfoo}}" # placeholder
            
            # Heuristic: Check if previous member matches pattern
            if len(sorted_members) > 1:
                prev_name = sorted_members[-2]['name']
                prev_match = re.search(r'^(.*?)(\d+)$', prev_name)
                if prev_match and prev_match.group(1) == base:
                    # Valid pattern likely
                    pass
            
            next_idx = current_num + 1
            pattern = f"{base}{{0:0{num_len}d}}" # python format string e.g. "remote-{0:02d}"
        
    return UnionAnalysis(
        union_name=union_name,
        upstreams=upstream_names,
        detected_pattern=pattern,
        next_index=next_idx if next_idx is not None else 1,
        members=members
    )

def propose_expansion(analysis: UnionAnalysis, count: int = 1) -> List[ExpansionProposal]:
    """
    Propose new remotes to add to the union based on analysis.
    """
    proposals = []
    
    if not analysis.members:
        return []

    # Base configuration on the last member
    # Sort members to find the 'latest' one to copy from
    sorted_members = sorted(analysis.members, key=lambda x: x['name'])
    template_member = sorted_members[-1]
    
    base_remote_name = template_member['name']
    
    # Try to determine associated Drive Name?
    # Usually we don't know the Drive Name from rclone config alone unless it's stored there?
    # But usually users name them similarly.
    # We might need to ask the user or just assume a name.
    # For this proposal, we'll use the remote name as the basis for the Drive Name proposal too.
    
    start_idx = analysis.next_index or 1
    
    # Name generation
    # If pattern detected, use it.
    # If not, append "-new-N"
    
    for i in range(count):
        idx = start_idx + i
        
        if analysis.detected_pattern:
             # e.g. base-{0:02d}
             # We need to reconstruct the format string logic
             # The pattern stored in analysis as python format string?
             # Let's simplify.
             
             # Re-parsing pattern from analysis might be complex if we stored it vaguely.
             # let's just use the logic here:
             match = re.search(r'^(.*?)(\d+)$', base_remote_name)
             if match:
                 base = match.group(1)
                 num_str = match.group(2)
                 width = len(num_str)
                 new_name = f"{base}{idx:0{width}d}"
             else:
                 new_name = f"{base_remote_name}-{idx}"
        else:
            new_name = f"{base_remote_name}-{idx}"
            
        proposals.append(ExpansionProposal(
            new_remote_name=new_name,
            new_drive_name=new_name, # Usually match
            based_on_remote=base_remote_name,
            service_account_file=template_member.get('service_account_file'),
            team_drive_id=template_member.get('team_drive')
        ))
        
    return proposals
