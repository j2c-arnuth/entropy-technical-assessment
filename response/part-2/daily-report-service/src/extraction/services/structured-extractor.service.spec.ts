import { Test, TestingModule } from '@nestjs/testing';
import { StructuredExtractorService } from './structured-extractor.service';
import { ExtractionConfidence } from '../interfaces/extraction-result.interface';

describe('StructuredExtractorService', () => {
  let service: StructuredExtractorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StructuredExtractorService],
    }).compile();

    service = module.get<StructuredExtractorService>(StructuredExtractorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('extract', () => {
    it('should extract weather data with high confidence', () => {
      const pdfText = `
        Weather:
        Sky: Clear
        High: 75°F
        Low: 55°F
        No precipitation expected.
      `;

      const result = service.extract(pdfText);

      expect(result.weather.data).toBeDefined();
      expect(result.weather.data?.conditions).toContain('Clear');
      expect(result.weather.data?.temperatureHigh).toBe(75);
      expect(result.weather.data?.temperatureLow).toBe(55);
      expect(result.weather.confidence).toBe(ExtractionConfidence.HIGH);
      expect(result.weather.needsLlmFallback).toBe(false);
    });

    it('should extract weather data from temperature range format', () => {
      const pdfText = `
        Weather:
        Temperature: 75°/55°F
        Conditions: Partly Cloudy
      `;

      const result = service.extract(pdfText);

      expect(result.weather.data?.temperatureHigh).toBe(75);
      expect(result.weather.data?.temperatureLow).toBe(55);
      expect(result.weather.confidence).toBe(ExtractionConfidence.HIGH);
    });

    it('should flag weather as needing fallback when no patterns match', () => {
      const pdfText = `
        Weather:
        Nice day today. Good working conditions.
      `;

      const result = service.extract(pdfText);

      expect(result.weather.needsLlmFallback).toBe(true);
      expect(result.weather.confidence).toBe(ExtractionConfidence.LOW);
    });

    it('should extract manpower data with crew entries', () => {
      const pdfText = `
        Manpower:
        ABC Electric: 5 workers
        XYZ Plumbing: 3 workers
        Total: 8 workers
      `;

      const result = service.extract(pdfText);

      expect(result.manpower.data).toBeDefined();
      expect(result.manpower.data?.totalWorkers).toBe(8);
      expect(result.manpower.data?.crews.length).toBeGreaterThan(0);
      expect(result.manpower.confidence).toBe(ExtractionConfidence.HIGH);
      expect(result.manpower.needsLlmFallback).toBe(false);
    });

    it('should calculate total from crews when not explicitly provided', () => {
      const pdfText = `
        Manpower:
        Company A: 5 workers
        Company B: 3 workers
      `;

      const result = service.extract(pdfText);

      expect(result.manpower.data?.totalWorkers).toBe(8);
    });

    it('should extract work areas with status', () => {
      const pdfText = `
        Work Areas:
        Building A: In Progress
        Floor 2: Complete
        Parking Lot: Delayed
      `;

      const result = service.extract(pdfText);

      expect(result.workAreas.data).toBeDefined();
      expect(result.workAreas.data?.length).toBe(3);
      expect(result.workAreas.confidence).toBe(ExtractionConfidence.HIGH);
    });

    it('should extract notes section', () => {
      const pdfText = `
        Notes:
        Concrete pour scheduled for tomorrow.
        Safety meeting held at 7am.
        No incidents reported.
      `;

      const result = service.extract(pdfText);

      expect(result.notes.data).toBeDefined();
      expect(result.notes.data).toContain('Concrete pour');
      expect(result.notes.confidence).toBe(ExtractionConfidence.HIGH);
    });

    it('should handle missing sections gracefully', () => {
      const pdfText = `
        Some random text without any section headers.
      `;

      const result = service.extract(pdfText);

      expect(result.weather.data).toBeNull();
      expect(result.manpower.data).toBeNull();
      expect(result.workAreas.data).toBeNull();
      expect(result.notes.data).toBeNull();
    });

    it('should handle multiple sections in one document', () => {
      const pdfText = `
        Weather:
        High: 80°F
        Low: 60°F
        Conditions: Sunny

        Manpower:
        Total: 15 workers

        Work Areas:
        Main Building: In Progress

        Notes:
        Good progress today.
      `;

      const result = service.extract(pdfText);

      expect(result.weather.data).toBeDefined();
      expect(result.manpower.data).toBeDefined();
      expect(result.workAreas.data).toBeDefined();
      expect(result.notes.data).toBeDefined();
    });

    it('should handle alternative section header names', () => {
      const pdfText = `
        Observed Weather Conditions:
        High: 70°F
        Low: 50°F

        Workforce:
        Total: 10 workers

        Observations:
        All systems operational.
      `;

      const result = service.extract(pdfText);

      expect(result.weather.data).toBeDefined();
      expect(result.manpower.data).toBeDefined();
      expect(result.notes.data).toBeDefined();
    });
  });
});
