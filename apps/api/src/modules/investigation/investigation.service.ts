import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Investigation } from './entities/investigation.entity';
import { Company } from '../companies-house/entities/company.entity';
import { Officer } from '../companies-house/entities/officer.entity';
import { CompanyOfficer } from '../companies-house/entities/company-officer.entity';
import { Address } from '../companies-house/entities/address.entity';
import { PSC } from '../companies-house/entities/psc.entity';
import { CompaniesHouseService } from '../companies-house/companies-house.service';

@Injectable()
export class InvestigationService {
  private readonly logger = new Logger(InvestigationService.name);

  constructor(
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(Officer) private readonly officers: Repository<Officer>,
    @InjectRepository(CompanyOfficer) private readonly companyOfficers: Repository<CompanyOfficer>,
    @InjectRepository(Address) private readonly addresses: Repository<Address>,
    @InjectRepository(PSC) private readonly pscs: Repository<PSC>,
    private readonly ch: CompaniesHouseService,
  ) {}

  async create(query: string): Promise<Investigation> {
    const inv = this.investigations.create({ query, status: 'QUEUED' });
    const saved = await this.investigations.save(inv);
    // Run async, do not await
    this.run(saved.id).catch((e) => this.logger.error(`Investigation ${saved.id} failed: ${e?.message}`));
    return saved;
  }

  async findOne(id: string): Promise<any> {
    const inv = await this.investigations.findOne({ where: { id } });
    if (!inv) throw new NotFoundException('Investigation not found');

    let result: any = { id: inv.id, query: inv.query, status: inv.status, createdAt: inv.createdAt, completedAt: inv.completedAt };
    if (inv.metadata?.companyNumber) {
      const company = await this.companies.findOne({
        where: { companyNumber: inv.metadata.companyNumber },
      });
      if (company) {
        const cos = await this.companyOfficers.find({
          where: { company: { id: company.id } },
          relations: ['officer'],
        });
        const officersWithAppointments = await Promise.all(
          cos.map(async (co) => ({
            id: co.officer.externalId,
            name: co.officer.name,
            role: co.role,
            appointedOn: co.appointedOn,
            resignedOn: co.resignedOn,
            nationality: co.officer.nationality,
            otherAppointments: inv.metadata?.officerAppointments?.[co.officer.externalId] || [],
          })),
        );
        const psc = await this.pscs.find({ where: { company: { id: company.id } } });
        result.company = company;
        result.officers = officersWithAppointments;
        result.psc = psc;
      }
    }
    if (inv.metadata?.error) result.error = inv.metadata.error;
    return result;
  }

  private async run(id: string) {
    await this.investigations.update(id, { status: 'FETCHING' });
    try {
      const inv = await this.investigations.findOneByOrFail({ id });
      const companyNumber = await this.resolveCompanyNumber(inv.query);
      if (!companyNumber) throw new Error('Company not found');

      const profile = await this.ch.getCompany(companyNumber);
      const officersResp = await this.ch.getOfficers(companyNumber).catch(() => ({ items: [] }));
      const pscResp = await this.ch.getPSC(companyNumber).catch(() => ({ items: [] }));

      // Save address
      let address: Address | null = null;
      if (profile.registered_office_address) {
        const a = profile.registered_office_address;
        address = await this.addresses.save(this.addresses.create({
          addressLine1: a.address_line_1,
          addressLine2: a.address_line_2,
          locality: a.locality,
          region: a.region,
          postalCode: a.postal_code,
          country: a.country,
          normalized: [a.address_line_1, a.locality, a.postal_code].filter(Boolean).join(', ').toLowerCase(),
        }));
      }

      // Upsert company
      let company = await this.companies.findOne({ where: { companyNumber: profile.company_number } });
      if (!company) company = this.companies.create({ companyNumber: profile.company_number });
      company.name = profile.company_name;
      company.status = profile.company_status;
      company.incorporationDate = profile.date_of_creation;
      company.companyType = profile.type;
      company.jurisdiction = profile.jurisdiction;
      company.sicCodes = profile.sic_codes || [];
      if (address) company.address = address;
      company = await this.companies.save(company);

      // Officers
      const officerAppointmentsMap: Record<string, any[]> = {};
      for (const item of officersResp.items || []) {
        const externalId = item.links?.officer?.appointments?.split('/')[2] || item.name;
        let officer = await this.officers.findOne({ where: { externalId } });
        if (!officer) officer = this.officers.create({ externalId });
        officer.name = item.name;
        officer.nationality = item.nationality;
        officer.dateOfBirthMonth = item.date_of_birth?.month;
        officer.dateOfBirthYear = item.date_of_birth?.year;
        officer = await this.officers.save(officer);

        // junction
        const existingCO = await this.companyOfficers.findOne({
          where: { company: { id: company.id }, officer: { id: officer.id } },
        });
        if (!existingCO) {
          await this.companyOfficers.save(this.companyOfficers.create({
            company,
            officer,
            role: item.officer_role,
            appointedOn: item.appointed_on,
            resignedOn: item.resigned_on,
          }));
        }

        // Other appointments
        try {
          const appts = await this.ch.getOfficerAppointments(externalId);
          officerAppointmentsMap[externalId] = (appts.items || [])
            .filter((x: any) => x.appointed_to?.company_number !== company!.companyNumber)
            .map((x: any) => ({
              companyNumber: x.appointed_to?.company_number,
              companyName: x.appointed_to?.company_name,
              role: x.officer_role,
            }));
        } catch (e) {
          officerAppointmentsMap[externalId] = [];
        }
      }

      // PSCs
      for (const item of pscResp.items || []) {
        const exists = await this.pscs.findOne({
          where: { company: { id: company.id }, name: item.name },
        });
        if (!exists) {
          await this.pscs.save(this.pscs.create({
            company,
            name: item.name,
            kind: item.kind,
            naturesOfControl: item.natures_of_control || [],
            notifiedOn: item.notified_on,
          }));
        }
      }

      await this.investigations.update(id, {
        status: 'COMPLETE',
        completedAt: new Date(),
        metadata: { companyNumber: company.companyNumber, officerAppointments: officerAppointmentsMap } as any,
      });
    } catch (err: any) {
      this.logger.error(`Investigation ${id} failed: ${err?.message}`);
      await this.investigations.update(id, {
        status: 'FAILED',
        completedAt: new Date(),
        metadata: { error: err?.message || 'Unknown error' } as any,
      });
    }
  }

  private async resolveCompanyNumber(query: string): Promise<string | null> {
    if (/^[A-Z0-9]{6,10}$/i.test(query.trim())) return query.trim().toUpperCase();
    const result = await this.ch.searchCompanies(query).catch(() => null);
    const first = result?.items?.[0];
    return first?.company_number || null;
  }
}
