S=/tmp/claude-0/-home-user/4a462171-4839-5722-82b5-e32963b69e2d/scratchpad; T=/home/user/hazard-check/tools
while [ $# -gt 0 ]; do w=$1; lat=$2; fresh=$3; shift 3
  cd $S/$w && echo "=== $w" && CFG=frames.json LAT=$lat python3 $T/align_ward.py $fresh 2>&1 | tail -16
done
echo ALLDONE
