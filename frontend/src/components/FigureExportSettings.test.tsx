import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FigureExportSettings } from './FigureExportSettings';
import { useBoardStore, computeSaveHashes } from '@/store/boardStore';
import { CURRENT_SCHEMA_VERSION, DEFAULT_BOARD_SETUP, DEFAULT_CANVAS, type Board } from '@/types/board';

function board(): Board {
  return {
    schema_version: CURRENT_SCHEMA_VERSION, id: 'export-options', name: 'Test',
    canvas: { ...DEFAULT_CANVAS }, elements: [], setup: { ...DEFAULT_BOARD_SETUP }, plotCodes: {},
    created_at: '', updated_at: '', app_version: 'test',
    autoExport: {
      enabled: true, outputPath: '/tmp/test.svg', format: 'svg', dpi: 1,
      transparent: false, sizeMode: 'canvas', fixedWidth: 640, fixedHeight: 480,
      ...{ sourceBoard: 'test.sdraw' },
    },
  };
}

describe('FigureExportSettings', () => {
  beforeEach(() => useBoardStore.setState({ board: board(), isDirty: false }));

  it('loads the saved mode and preserves the source, output path and canvas', () => {
    const before = useBoardStore.getState().board!;
    render(<FigureExportSettings />);
    expect(screen.getByLabelText('Export framing')).toHaveValue('canvas');
    fireEvent.change(screen.getByLabelText('Export framing'), { target: { value: 'fit' } });
    const after = useBoardStore.getState().board!;
    expect(after.autoExport).toEqual({ ...before.autoExport, sizeMode: 'fit' });
    expect(after.canvas).toEqual(before.canvas);
    expect(after.elements).toEqual(before.elements);
    expect(useBoardStore.getState().isDirty).toBe(true);
    expect(computeSaveHashes(after).boardFieldsHash).not.toBe(computeSaveHashes(before).boardFieldsHash);
  });

  it('updates custom dimensions and retains them when switching modes', () => {
    render(<FigureExportSettings />);
    fireEvent.change(screen.getByLabelText('Export framing'), { target: { value: 'fixed' } });
    fireEvent.change(screen.getByLabelText('Export width'), { target: { value: '800' } });
    fireEvent.change(screen.getByLabelText('Export height'), { target: { value: '600' } });
    fireEvent.change(screen.getByLabelText('Export framing'), { target: { value: 'fit' } });
    expect(screen.queryByLabelText('Export width')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Export framing'), { target: { value: 'fixed' } });
    expect(screen.getByLabelText('Export width')).toHaveValue(800);
    expect(screen.getByLabelText('Export height')).toHaveValue(600);
  });

  it('rejects empty and invalid dimensions', () => {
    render(<FigureExportSettings />);
    fireEvent.change(screen.getByLabelText('Export framing'), { target: { value: 'fixed' } });
    for (const value of ['', '0', '-10', '99']) {
      fireEvent.change(screen.getByLabelText('Export width'), { target: { value } });
      expect(useBoardStore.getState().board?.autoExport?.fixedWidth).toBe(640);
    }
  });

  it('disables settings while saving', () => {
    useBoardStore.getState().updateAutoExport({ sizeMode: 'fixed' });
    render(<FigureExportSettings disabled />);
    expect(screen.getByLabelText('Export framing')).toBeDisabled();
    expect(screen.getByLabelText('Export width')).toBeDisabled();
    expect(screen.getByLabelText('Export height')).toBeDisabled();
  });

  it('defaults an unconfigured board to fit without enabling export', () => {
    const initial = board();
    delete initial.autoExport;
    useBoardStore.setState({ board: initial });
    render(<FigureExportSettings />);
    expect(screen.getByLabelText('Export framing')).toHaveValue('fit');
    fireEvent.change(screen.getByLabelText('Export framing'), { target: { value: 'canvas' } });
    expect(useBoardStore.getState().board?.autoExport?.enabled).toBe(false);
  });
});
