import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmExtractorService } from './llm-extractor.service';
import { ExtractionConfidence } from '../interfaces/extraction-result.interface';

// Mock OpenAI
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }));
});

describe('LlmExtractorService', () => {
  let service: LlmExtractorService;
  let mockOpenAICreate: jest.Mock;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        LLM_API_KEY: 'test-api-key',
        LLM_MODEL: 'gpt-4',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Get mock function reference
    const OpenAI = require('openai');
    mockOpenAICreate = jest.fn();
    OpenAI.mockImplementation(() => ({
      chat: {
        completions: {
          create: mockOpenAICreate,
        },
      },
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmExtractorService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<LlmExtractorService>(LlmExtractorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('extractSection', () => {
    it('should extract weather data from LLM response', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                data: {
                  conditions: 'Sunny',
                  temperatureHigh: 80,
                  temperatureLow: 60,
                  notes: 'Clear skies all day',
                },
              }),
            },
          },
        ],
      };
      mockOpenAICreate.mockResolvedValue(mockResponse);

      const result = await service.extractSection('weather', 'Some weather text');

      expect(result.data).toBeDefined();
      expect(result.confidence).toBe(ExtractionConfidence.MEDIUM);
      expect(result.needsLlmFallback).toBe(false);
    });

    it('should handle empty LLM response', async () => {
      const mockResponse = {
        choices: [{ message: { content: '' } }],
      };
      mockOpenAICreate.mockResolvedValue(mockResponse);

      const result = await service.extractSection('weather', 'Some text');

      expect(result.data).toBeNull();
      expect(result.confidence).toBe(ExtractionConfidence.LOW);
    });

    it('should handle LLM API errors gracefully', async () => {
      mockOpenAICreate.mockRejectedValue(new Error('API rate limit exceeded'));

      const result = await service.extractSection('weather', 'Some text');

      expect(result.data).toBeNull();
      expect(result.confidence).toBe(ExtractionConfidence.LOW);
    });

    it('should handle invalid JSON in LLM response', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'not valid json' } }],
      };
      mockOpenAICreate.mockResolvedValue(mockResponse);

      const result = await service.extractSection('weather', 'Some text');

      expect(result.data).toBeNull();
      expect(result.confidence).toBe(ExtractionConfidence.LOW);
    });
  });

  describe('detectConflicts', () => {
    it('should detect manpower total mismatch', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ conflicts: [] }) } }],
      });

      const extractedData = {
        manpower: {
          totalWorkers: 10,
          crews: [
            { trade: 'Electrical', count: 3, subcontractor: 'ABC' },
            { trade: 'Plumbing', count: 2, subcontractor: 'XYZ' },
          ],
          notes: '',
        },
      };

      const warnings = await service.detectConflicts(extractedData);

      // Should detect programmatic mismatch (10 != 3 + 2)
      expect(warnings.some((w) => w.type === 'manpower_total_mismatch')).toBe(
        true,
      );
    });

    it('should not flag when totals match', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ conflicts: [] }) } }],
      });

      const extractedData = {
        manpower: {
          totalWorkers: 5,
          crews: [
            { trade: 'Electrical', count: 3, subcontractor: 'ABC' },
            { trade: 'Plumbing', count: 2, subcontractor: 'XYZ' },
          ],
          notes: '',
        },
      };

      const warnings = await service.detectConflicts(extractedData);

      expect(warnings.some((w) => w.type === 'manpower_total_mismatch')).toBe(
        false,
      );
    });

    it('should include LLM-detected conflicts', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                conflicts: [
                  {
                    type: 'weather_inconsistency',
                    message: 'Notes mention rain but conditions say Clear',
                    sections: ['weather'],
                    severity: 'warning',
                  },
                ],
              }),
            },
          },
        ],
      });

      const extractedData = {
        weather: {
          conditions: 'Clear',
          temperatureHigh: 75,
          temperatureLow: 55,
          notes: 'Rain caused delays in the afternoon',
        },
      };

      const warnings = await service.detectConflicts(extractedData);

      expect(warnings.some((w) => w.type === 'weather_inconsistency')).toBe(
        true,
      );
    });

    it('should handle LLM errors during conflict detection', async () => {
      mockOpenAICreate.mockRejectedValue(new Error('API error'));

      const extractedData = {
        weather: {
          conditions: 'Clear',
          temperatureHigh: 75,
          temperatureLow: 55,
          notes: '',
        },
      };

      // Should not throw, just return empty LLM warnings
      const warnings = await service.detectConflicts(extractedData);
      expect(Array.isArray(warnings)).toBe(true);
    });

    it('should skip LLM detection for minimal data', async () => {
      const extractedData = {};

      const warnings = await service.detectConflicts(extractedData);

      expect(warnings).toEqual([]);
      expect(mockOpenAICreate).not.toHaveBeenCalled();
    });
  });
});
