import { hexToLinear, linearToHex, type Triplet } from './color';

// Симуляция нарушений цветового зрения по модели Machado, Oliveira, Fernandes (2009)
// при полной выраженности (severity 1.0). Матрицы применяются к линейному RGB.

export type Vision = 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia';

type Matrix = [Triplet, Triplet, Triplet];

const MATRICES: Record<Exclude<Vision, 'normal'>, Matrix> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** Все варианты зрения, для которых проверяются шкалы. */
export const VISIONS: readonly { id: Vision; label: string; note: string }[] = [
  { id: 'normal', label: 'Typical vision', note: 'No simulation' },
  { id: 'deuteranopia', label: 'Deuteranopia', note: 'No green cones, the most common type' },
  { id: 'protanopia', label: 'Protanopia', note: 'No red cones' },
  { id: 'tritanopia', label: 'Tritanopia', note: 'No blue cones, rare' },
];

/** Как цвет '#rrggbb' выглядит при заданном типе зрения. */
export function simulate(hex: string, vision: Vision): string {
  if (vision === 'normal') return hex.toLowerCase();
  const [r, g, b] = hexToLinear(hex);
  const matrix = MATRICES[vision];
  const row = (m: Triplet) => m[0] * r + m[1] * g + m[2] * b;
  return linearToHex([row(matrix[0]), row(matrix[1]), row(matrix[2])]);
}
