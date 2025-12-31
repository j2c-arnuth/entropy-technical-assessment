# Procore Daily Report Format

Research document describing the structure of Procore daily report PDF exports for use in extraction logic.

## Sources

- [Daily Log Overview - Procore](https://support.procore.com/products/online/user-guide/project-level/daily-log/tutorials/daily-log-overview)
- [Export a Daily Log as PDF - Procore](https://support.procore.com/products/online/user-guide/project-level/daily-log/tutorials/export-a-daily-log-as-pdf)
- [Create Observed Weather Condition Entries - Procore](https://support.procore.com/products/online/user-guide/project-level/daily-log/tutorials/create-observed-weather-entries)
- [Procore Developers - Daily Logs](https://developers.procore.com/documentation/daily-logs)

## Overview

The Procore Daily Log tool contains **21 configurable sections**. Users can configure which sections appear, their order, and filters using drag-and-drop tools. PDF exports can cover a single day or a date range.

## Daily Log Sections

Sections marked with * are enabled by default.

### Primary Tracking Sections

| Section | Purpose | Key Fields |
|---------|---------|------------|
| Weather* | Monitors conditions affecting project progress | Sky, temperature, precipitation, wind, ground/sea, calamity |
| Manpower* | Records on-site personnel details | Companies, workers, hours, cost codes |
| Notes* | Captures miscellaneous information | Free-form text, issues flag |
| Timecards* | Tracks internal employee hours | Hours, billability status |
| Equipment* | Documents machine usage | Hours, inspection times, cost codes |

### Site Activity Sections

| Section | Purpose | Key Fields |
|---------|---------|------------|
| Visitors* | Records site visits | Visitor name, company, visit description |
| Phone Calls* | Logs communications | Discussion topics |
| Inspections* | Tracks third-party inspector activities | Inspector, inspection type |
| Deliveries* | Records shipments | Sender, tracking number, contents |
| Accidents* | Documents incidents | Parties involved, companies |

### Work Planning & Materials

| Section | Purpose | Key Fields |
|---------|---------|------------|
| Scheduled Work* | Tracks resource availability | Worker counts, hours, compensation |
| Daily Construction Report* | Aggregates worker totals | Workers by vendor/company and trade |
| Quantities* | Monitors material usage | Material amounts |
| Productivity* | Tracks installations vs arrivals | Contract line items |
| Dumpster* / Waste* | Monitor disposal logistics | Disposal tracking |

### Documentation & Compliance

| Section | Purpose | Key Fields |
|---------|---------|------------|
| Safety Violations* | Records hazardous actions | Photos, timestamps, dates |
| Plan Revisions* | Tracks plan changes | Revision, title, category, comments |
| Delays* | Documents work interruptions | Occurrence, causes |
| Photos* | Aggregates jobsite imagery | Daily progress photos |
| Change History* | Lists all modifications | Editor attribution |

## Weather Section Details

Weather data is automatically pulled from the project location via Dark Sky service or compatible on-site weather stations. Manual input can supplement automatic data.

### Weather Fields

| Field | Type | Description |
|-------|------|-------------|
| Time Observed | Time | When conditions were observed (required) |
| Sky | Dropdown | Sky conditions (Clear, Partly Cloudy, Cloudy, etc.) |
| Temperature | Dropdown | Approximate temperature on site |
| Average | Number | Average temperature during workday |
| Precipitation | Text | Observed precipitation amounts |
| Wind | Dropdown | Wind conditions |
| Ground/Sea | Dropdown | Ground or sea status (mutually exclusive) |
| Calamity | Dropdown | If applicable: earthquake, fire, flash flood, landslide, tornado, hurricane, snow, other |
| Delay | Checkbox | Triggers weather delay notifications |
| Comments | Text | Additional observations |
| Attachments | Files | Supporting documentation |

### Weather Configuration Options

- **Hide Weather Data**: Option to exclude National Weather Service data from PDF exports

## Manpower Section Details

Records people on site who completed work on the project for that day.

### Manpower Fields

| Field | Type | Description |
|-------|------|-------------|
| Company | Dropdown | Company/subcontractor on site |
| Workers | Number | Number of workers |
| Hours | Number | Hours worked (configurable default) |
| Cost Code | Reference | Associated cost code |
| Trade | Text | Trade type (customizable) |

### Manpower Configuration Options

- **Default Hours**: Pre-populate hours field for faster entry
- **Set Hours to Zero on Copy**: Reset hours/workers when copying entries
- **Include Employees in Dropdown**: Allow selecting individual employees

### Daily Construction Report

Aggregates total workers and hours by:
- Vendor/company
- Trade

Additional workforce labor categories (configurable):
- Women
- Veteran
- Minority
- First-Year Apprentice
- Local (City)
- Local (County)

## Notes Section Details

Captures miscellaneous information with special capabilities:
- Mark items as 'issues' for dedicated reporting
- Free-form text entry
- Dynamic resizing for longer entries

## PDF Export Characteristics

### Export Options

1. **Single Day**: Export specific date
2. **Date Range**: Export multiple days in one PDF

### Export Process

From List view → Select date(s) → Click Export → Click PDF

### PDF Structure

- Sections appear in configured order
- Each section has its header
- Tables for structured data (manpower, equipment)
- Free-form text preserved from notes fields
- Weather data may include automatic snapshots

### Configurability Impact

The PDF structure varies based on:
- Which sections are enabled for the project
- Custom fields added to sections
- Fieldset configurations
- Section ordering preferences

## Extraction Implications

### Reliable Patterns

1. **Section Headers**: Each section starts with its name as header
2. **Tabular Data**: Manpower, equipment use table format
3. **Weather Snapshot**: Usually near top, includes date/time
4. **Notes**: Free-form but within "Notes" section boundary

### Variable Elements

1. **Custom Fields**: Projects may add custom fields to any section
2. **Section Order**: User-configurable, not fixed
3. **Missing Sections**: Not all sections enabled for all projects
4. **Field Labels**: May vary by language/configuration

### Extraction Strategy Recommendations

1. **Section Detection**: Use header text patterns to identify section boundaries
2. **Flexible Parsing**: Handle missing sections gracefully
3. **Table Recognition**: Look for tabular patterns in manpower/equipment
4. **Weather Patterns**: Temperature often appears as "High: X° / Low: Y°" or similar
5. **LLM Fallback**: Use for ambiguous content or non-standard formats
