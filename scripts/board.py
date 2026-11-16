"""Read and convert HTML / JSON / legacy sdraw without launching the editor."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from services.board_format import read_board, write_board
from services.board_cache import migrate_board_schema


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    board = migrate_board_schema(read_board(args.source))
    if args.output:
        if args.output.exists():
            parser.error('Output exists; choose a new path')
        args.output.parent.mkdir(parents=True, exist_ok=True)
        write_board(args.output, board)
    else:
        print(json.dumps(board, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
