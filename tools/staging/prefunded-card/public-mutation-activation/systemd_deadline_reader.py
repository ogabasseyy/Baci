import re

import mutation_contract
from readiness_evidence_io import command as originalcommand, require
from readiness_evidence_timers import PREFIX, STOPS


def wrapper(arguments, run=originalcommand, **kwargs):
    properties = '--property=FragmentPath,DropInPaths,NeedDaemonReload,LoadState,ExecStart'
    units = {stem + '.service': stops for stem, stops in STOPS.items()}
    matched = next((unit for unit in units if arguments in (
        ['/usr/bin/systemctl', 'show', properties, unit],
        ['/usr/bin/systemctl', 'show', '--no-pager', properties, unit])), None)
    output = run(arguments, **kwargs)
    if matched is None:
        return output
    require(isinstance(output, str) and len(output) <= 32768 and '\r' not in output,
            'deadline_reader_output_refused')
    rows = output.splitlines(keepends=True)
    values = {}
    records = []
    for row in rows:
        line = row.removesuffix('\n')
        require('=' in line, 'deadline_reader_property_refused')
        name, value = line.split('=', 1)
        if name == 'ExecStart':
            require(value.strip(), 'deadline_reader_empty_command')
            records.append(value)
        else:
            require(name not in values, 'deadline_reader_duplicate_property')
            values[name] = value
    require(values == {'FragmentPath': PREFIX + matched, 'DropInPaths': '',
            'NeedDaemonReload': 'no', 'LoadState': 'loaded'},
            'deadline_reader_loaded_properties_refused')
    commands = []
    for value in records:
        position = 0
        for record in re.finditer(r'\{([^{}]*)\}', value):
            require(not value[position:record.start()].strip(), 'deadline_reader_command_junk')
            fields = []
            for field in record[1].split(';'):
                require('=' in field, 'deadline_reader_command_field_refused')
                key, content = field.strip().split('=', 1)
                require(key not in [name for name, unused in fields],
                        'deadline_reader_duplicate_command_field')
                fields.append((key, content.strip()))
            require([key for key, content in fields[:3]] == ['path', 'argv[]', 'ignore_errors']
                    and fields[2][1] == 'no'
                    and all(key in ('start_time', 'stop_time', 'pid', 'code', 'status')
                            for key, content in fields[3:]), 'deadline_reader_command_fields_refused')
            commands.append((fields[0][1], fields[1][1]))
            position = record.end()
        require(position and not value[position:].strip(), 'deadline_reader_command_junk')
    require(commands == [(stop.split()[0], stop) for stop in units[matched]],
            'deadline_reader_ordered_targets_refused')
    normalized = []
    inserted = False
    for row in rows:
        if row.startswith('ExecStart='):
            if not inserted:
                normalized.append('ExecStart=' + ' '.join(records) + ('\n' if row.endswith('\n') else ''))
                inserted = True
        else:
            normalized.append(row)
    return ''.join(normalized)
