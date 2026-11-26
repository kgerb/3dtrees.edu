"""Convert every crop listed in attribution.json (from the geos export) into assets/hero/.

    python tools/make_all_hero_clouds.py /path/to/hero/attribution.json
"""
import json, os, subprocess, sys

src = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
for key, d in json.load(open(src)).items():
    names = [a["last_name"] for a in d["authors"]]
    who = names[0] if len(names) == 1 else " & ".join(names) if len(names) == 2 else names[0] + " et al."
    lic = d["licence"].replace("CC-BY-", "CC BY ")
    subprocess.run([sys.executable, os.path.join(here, "make_hero_clouds.py"),
                    os.path.join(os.path.dirname(src), d["file"]), key,
                    "--size", str(d["crop"]["size_m"]), "--dataset", str(d["dataset_id"]),
                    "--license", lic, "--credit", f"{who} ({d['year']})"], check=True)
